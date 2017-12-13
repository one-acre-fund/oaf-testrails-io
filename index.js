#!/usr/bin/env node

//
// TestRail Input/Output to Manual Test Files Utility
//

const program = require('commander');
const fs = require('fs');
const path = require('path');
const fsUtils = require('nodejs-fs-utils');
const simpleGit = require('simple-git');
const childProcess = require('child_process');
const csv = require('csv');
const moment = require('moment');
moment.suppressDeprecationWarnings = true;

// Top-level module flags
let flags = {
    verbose: false
};

// Checks if the directory is a git repo
// (Needed b/c simple-git has fatal errors when you don't check)
function isGitRepo(dirPath) {
    try {
        childProcess.execSync('git rev-parse --is-inside-work-tree', {
            cwd: dirPath,
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf8'
        });
    } catch (err) {
        if (err.stderr && err.stderr.match(/Not a git repository/))
            return false;
        throw err;
    }
    return true;
}

// Reads a test file relative to some test directory root
// Promises the content as well as any applicable git information in
// a Promise
function readTestFile(testFile, testRoot) {

    return new Promise((resolve, reject) => {

        if (flags.verbose) console.log("Reading test file at", testFile);

        fs.readFile(testFile, 'utf8', (err, content) => {
            if (err) reject(err);

            // Check for git info
            let testDir = path.dirname(testFile);
            if (!isGitRepo(testDir)) {
                resolve([path.relative(testRoot, testFile), content, null, null]);
                return;
            }

            // Read git info
            let git = simpleGit(testDir);

            // Latest log entry 
            git.log([-1], (err, currLog) => {
                if (err) reject(err);

                // File creation
                git.log(['-1', '--diff-filter=A', '--follow', '--', testFile], (err, createLog) => {
                    if (err) reject(err);
                    if (!createLog.latest) createLog.latest = currLog.latest;

                    // Last modification
                    git.log(['-1', '--', testFile], (err, modifiedLog) => {
                        if (err) reject(err);
                        if (!modifiedLog.latest) modifiedLog.latest = currLog.latest;

                        resolve([path.relative(testRoot, testFile),
                            content, createLog.latest, modifiedLog.latest
                        ]);
                    });
                });
            });
        });
    });
}

let testFileSuffix = ".test.txt";
let testFileSuffixRegex = /\.test\.txt$/;

// Reads a directory of manual test files (.test.txt)
// Promises the content and git information of all read test files 
function readTestDir(testDir) {

    return new Promise((resolve, reject) => {

        let reads = [];
        let readTestFiles = [];

        fsUtils.walk(testDir, (err, testPath, stats, next, cache) => {
            if (err) reject(err);

            if (!next) {
                Promise.all(reads).then(() => resolve(readTestFiles));
                return;
            }

            if (!stats.isDirectory() && testPath.match(testFileSuffixRegex)) {
                reads.push(
                    readTestFile(testPath, testDir)
                    .then((contentAndLogs) => {
                        readTestFiles.push(contentAndLogs);
                    }));
            }

            next();
        });
    });
}

//
// TestRail-specific fields
//

let trFields = [
    'ID',
    'Title',
    'Created By',
    'Created On',
    'Expected Result',
    'Milestone',
    'Priority',
    'References',
    'Section',
    'Section Depth',
    'Section Description',
    'Section Hierarchy',
    'Steps',
    'Suite',
    'Suite ID',
    'Type',
    'Updated By',
    'Updated On',
];

let trDate = function(date) {
    return moment(date).format("M/D/YYYY h:mm A");
};

let trSpecial = {
    'Created On': (date) => {
        return trDate(date);
    },
    'Updated On': (date) => {
        return trDate(date);
    },
    'Section Depth': (depth) => {
        return "" + depth;
    },
};

let trRegexes = [];

for (let i = 0; i < trFields.length; ++i) {
    trRegexes.push(new RegExp('^\\s?' + trFields[i] + '\\s?:\\s?(.*)$', 'i'));
}

// Saves a bunch of test files to a CSV formatted for TestRail
// Promises to return when done.
function saveToTrCsv(readTestFiles, outputFile, addGitFooter) {

    readTestFiles.sort((a, b) => {
        if (a[0] == b[0]) return 0;
        return a[0] < b[0] ? -1 : 1;
    });

    let csvRows = [trFields];

    for (let i = 0; i < readTestFiles.length; ++i) {

        let readTestFile = readTestFiles[i];
        let trRow = trRowFor(readTestFile, addGitFooter);

        // Convert the row objects into CSV row arrays
        let csvRow = [];
        for (let j = 0; j < trFields.length; ++j) {

            let trField = trFields[j];
            let value = null;

            if (trField in trRow) {
                value = trRow[trField];
                // Some fields need magic special handling (dates, numbers)
                if (trField in trSpecial) {
                    value = trSpecial[trField](value);
                }
            }

            csvRow.push(value);
        }

        csvRows.push(csvRow);
    }

    return new Promise((resolve, reject) => {

        if (flags.verbose) console.log("Saving to", outputFile, '...');

        csv.stringify(csvRows, {
            quoted: true
        }, (err, csvStr) => {
            if (err) reject(err);

            fs.writeFile(outputFile, csvStr, (err) => {
                if (err) reject(err);
                resolve();
            });
        });
    });
}

// Reads a CSV file containing tests (usually in TestRail format)
// Promises the row (objects) in the file
function readTestCsv(inputFile) {

    return new Promise((resolve, reject) => {

        fs.readFile(inputFile, (err, data) => {
            if (err) reject(err);

            csv.parse(data, {
                columns: true
            }, (err, rows) => {
                if (err) reject(err);

                resolve(rows);
            });
        });
    });
}

// Saves rows from a TestRail CSV file to individual test files in a directory
// Promises to return when the test directory files are created.
function saveToTestDir(testRows, testDir) {

    let sectionDirs = {};

    // Figure out all the directories we need to create first
    for (let i = 0; i < testRows.length; ++i) {

        // Create test file content for the next CSV row
        let [testFile, testContent] = testFor(testRows[i]);
        testFile = path.join(testDir, testFile);

        let sectionDir = path.dirname(testFile);
        if (!(sectionDir in sectionDirs)) {

            // Each directory gets a metadata description file, in case we
            // ever want to load Section Descriptions back to TestRail
            let descFile = path.join(sectionDir, 'Section.meta.txt');
            let descContent = testRows[i]['Section Description'];

            sectionDirs[sectionDir] = [
                [descFile, descContent],
                []
            ];
        }

        // Sort test file content to the appropriate directory
        sectionDirs[sectionDir][1].push([testFile, testContent]);
    };

    // Sort the directories in the order we want to create them
    let sortedDirs = [];

    for (let sectionDir in sectionDirs) {
        sortedDirs.push([sectionDir].concat(sectionDirs[sectionDir]));
    }

    sortedDirs.sort((a, b) => {
        return a[0] < b[0] ? -1 : 1;
    });

    // NOTE
    // Here we're creating directories one-at-a-time, and creating all
    // files in the directory in arbitrary order.  So we chain directory
    // promises and concatenate the file promises underneath those.
    let dirWrites = Promise.resolve();

    for (let i = 0; i < sortedDirs.length; ++i) {

        let [sectionDir, desc, tests] = sortedDirs[i];

        // Chain the next directory creation
        dirWrites = dirWrites.then(() => {
            return new Promise((resolve, reject) => {

                if (flags.verbose) console.log("Creating ", sectionDir);

                fsUtils.mkdirs(sectionDir, (err) => {
                    if (err) reject(err);

                    if (flags.verbose) console.log("Created dir", sectionDir);

                    let [descFile, descContent] = desc;

                    fs.writeFile(descFile, descContent, (err) => {
                        if (err) reject(err);

                        if (flags.verbose) console.log("Created desc file", descFile);

                        // Write all the files to the directory now
                        let testWrites = [];
                        for (let j = 0; j < tests.length; ++j) {

                            let [testFile, testContent] = tests[j];

                            if (flags.verbose) console.log("Writing file", testFile);

                            testWrites.push(new Promise((resolve, reject) => {
                                fs.writeFile(testFile, testContent, (err) => {
                                    if (err) reject(err);
                                    resolve();
                                });
                            }));
                        }

                        // Wait for the test file writes to complete, then move on
                        Promise.all(testWrites).then(() => resolve());
                    });
                });
            });
        });
    }

    return dirWrites;
};

// Returns a row object suitable for CSV export from a test file
// (optionally in a git repo)
function trRowFor([testFile, content, createLog, modifiedLog], addGitFooter) {

    let title = path.basename(testFile).replace(testFileSuffixRegex, "");

    let contentFields = {};

    // The format of tests is assumed to be:
    // (case insensitive)
    // > cat THE_TITLE.test.txt
    // SOME STEP 1
    // SOME STEP 2
    // EXPECTED RESULT:
    // WHAT SHOULD HAPPEN
    // FIELD VALUE: SOME VALUE
    //
    // Basically the title is the first (nonempty) line,
    // the steps ('Steps') come next until "Expected Result:" is seen,
    // then result ('Expected Result') lines are assumed.
    //
    // Arbitrary TestRail field values can also be specified
    // using FIELD:VALUE syntax (case/space insensitive), these
    // lines are ignored in steps and results.

    let lines = content.split('\n');
    let stepLines = [];
    let resultLines = [];

    let lineType = "step";

    for (let i = 0; i < lines.length; ++i) {

        let line = lines[i];
        let prevLineType = lineType;

        for (let j = 0; j < trRegexes.length; ++j) {

            let match = line.match(trRegexes[j]);
            if (match && match.length > 1) {

                if (trFields[j] == 'Expected Result') {
                    lineType = "result";
                    line = match[1];
                } else if (trFields[j] == 'Steps') {
                    lineType = "step";
                    line = match[1];
                } else {
                    lineType = "field";
                    contentFields[trFields[j]] = match[1];
                }

                break;
            }
        }

        if (lineType == "step") stepLines.push(line);
        else if (lineType == "result") resultLines.push(line);
        else if (lineType == "field") lineType = prevLineType;
    }

    // Title is first line of the steps
    let steps = stepLines.join('\n').trim();
    let results = resultLines.join('\n').trim();

    // The directory structure determines the TestRail 
    // 'Section Hierarchy'
    let hierarchy = pathToTrSection(testFile);

    if (createLog && modifiedLog && addGitFooter) {
        steps = steps + '\n\nLatest Update:\n' + 
            JSON.stringify(Object.assign({}, modifiedLog), null, 2);
    }

    let row = {
        'Title': title,
        'Steps': steps,
        'Section': hierarchy,
        'Expected Result': results
    };

    // Add creation/update times from git if available
    let gitInfo = {};
    if (createLog && modifiedLog) {
        gitInfo = {
            'Created By': createLog.author_name + ' (' + createLog.author_email + ')',
            'Created On': createLog.date,
            'Updated By': modifiedLog.author_name + ' (' + modifiedLog.author_email + ')',
            'Updated On': modifiedLog.date,
        };
    }

    Object.assign(row, gitInfo, contentFields);
    return row;
}

// TestRails allows nested Section specification on import by using
// " > "  as a separator
function pathToTrSection(testFile) {
    
    let trPath = testFile;
    if (path.isAbsolute(trPath)) {
        let parsed = path.parse(trPath);
        trPath = trPath.substring(parsed.root.length);
    }
    trPath = path.dirname(trPath);

    if (trPath == '.') return "";

    let hierarchy = trPath.split(path.sep);
    hierarchy = hierarchy.join(' > ');

    return hierarchy;
}

// Fields that we add from imported TestRail CSV rows to
// imported .test.txt files - these fields can then be
// re-exported to TestRail.
// NOTE that we don't save 'Updated' information - this
// is better pulled from git.
let persistedTrFields = [
    'ID',
    'Created By',
    'Created On',
    'Milestone',
    'Priority',
    'References',
    'Suite',
    'Suite ID',
    'Type'
];

// Translate a TestRail 'Section Hierarchy' into a path that's valid on
// multiple OSes - kill weird characters, etc.
function safePath(sectionPath, title) {

    sectionPath = sectionPath.replace(/[\\\/]/g, '_').replace(/ > /g, path.sep);
    title = title.replace(/[\\\/]/g, '_').substring(0, 200);

    fullPath = path.join(sectionPath, title);
    return fullPath.replace(/[^A-Za-z0-9\\\/]/g, '_');
}

// Creates test file content given a TestRail CSV row object -
// see trRowFor() for output format.
function testFor(trRow) {

    let sectionPath = 
        ('Section Hierarchy' in trRow && trRow['Section Hierarchy']) ? 
            trRow['Section Hierarchy'] : 
            trRow['Section'];

    let title = trRow['Title'];
    let testFile = safePath(sectionPath, title) + testFileSuffix;

    // These fields are kind of HTML-ish - double whitespace isn't rendered.
    // Our text files *do* care about this.
    let steps = trRow['Steps'];
    if (steps) steps = steps.replace(/[ \t]+/g, ' ');
    let results = trRow['Expected Result'];
    if (results) results = results.replace(/[ \t]+/g, ' ');

    let content = steps + "\n\n" +
        (results ? "Expected Result:\n" + results + "\n\n" : "");

    // Append any extra persisted TestRail data as fields in the
    // test file
    let fieldContent = [];
    for (let i = 0; i < persistedTrFields.length; ++i) {

        let trField = persistedTrFields[i];
        if (trRow[trField] == null) continue;

        fieldContent.push(trField + ": " + trRow[trField]);
    }

    content = content + fieldContent.join('\n');

    return [testFile, content];
}

if (!module.parent) {

    flags.verbose = true;

    // CLI entry point, when executed directly
    program
        .arguments('<test-dir> <output-file>')
        .option('--import', 'Import tests from .csv, not export to .csv')
        .option('--add-git-footer', 'Add human-readable git information as a footer to the exported test steps')
        .option('--quiet', 'Suppress output except errors')
        .action(function(testDir, outputFile) {

            if (program.quiet)
                flags.verbose = false;

            if (program.import) {
                readTestCsv(outputFile)
                    .then(testRows => saveToTestDir(testRows, testDir))
                    .then(() => {
                        if (flags.verbose) console.log("Done importing to", testDir);
                    });
            } else {
                readTestDir(testDir)
                    .then(readTestFiles => saveToTrCsv(readTestFiles, outputFile, program.addGitFooter))
                    .then(() => {
                        if (flags.verbose) console.log("Done exporting to", outputFile);
                    });
            }
        })
        .parse(process.argv);

} else {

    // require() entry point, use as module
    module.exports = flags;
    Object.assign(module.exports, {
        isGitRepo: isGitRepo,
        readTestDir: readTestDir,
        readTestFile: readTestFile,
        readTestCsv: readTestCsv,
        saveToTrCsv: saveToTrCsv,
        saveToTestDir: saveToTestDir,
        trRowFor: trRowFor,
        testFor: testFor
    });

}
