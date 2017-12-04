//
// Basic Unit Tests (mocha)
//

const trio = require('../index');
const assert = require('assert');
const path = require('path');
const tmp = require('tmp');
const fs = require('fs');
const csv = require('csv');

let testDir = path.dirname(require.resolve('./test'));
let sampleDir = path.join(testDir, 'samples');

// Create our tmp dir up-front to keep tests simpler
let tmpDirObj = tmp.dirSync();
let tmpDir = tmpDirObj.name;

describe('Read Test File', () => {

    it('should read content and git log info', () => {

        return trio.readTestFile(path.join(sampleDir, 'section', 'abcde.test.txt'), sampleDir)
            .then(([testFile, content, createLog, modifiedLog]) => {

                assert.equal(testFile, path.join('section', 'abcde.test.txt'));
                assert.equal(content.trim(), "abcde");
                assert(new Date(createLog.date) < new Date());
                assert(new Date(modifiedLog.date) < new Date());
            });
    });

    it('should load correct row content', () => {

        return trio
            // Read sample test
            .readTestFile(path.join(sampleDir, 'section', 'basic.test.txt'), testDir)
            // Make sure a sane row is created
            .then(readTestFile => {

                let row = trio.trRowFor(readTestFile);
                assert.equal(row['ID'], "ID");
                assert.equal(row['Priority'], "priority");
                assert.equal(row['Title'], "TITLE");
                assert.equal(row['Steps'], "STEPS");
                assert.equal(row['Expected Result'], "RESULT\n\nRESULT");

                assert.equal(row['Section'], "section");
                assert.equal(row['Section Depth'], 1);
                assert.equal(row['Section Hierarchy'], "samples > section");
            });
    });

    it('should save basically correct csv content', () => {

        let outputFile = path.join(tmpDir, 'output.csv');

        return trio
            // First read sample tests
            .readTestDir(sampleDir)
            .then(readTestFiles => trio.saveToTrCsv(readTestFiles, outputFile))
            // Now re-read the CSV file
            .then(() => new Promise((resolve, reject) => {

                fs.readFile(outputFile, (err, data) => {
                    if (err) reject(err);
                    resolve(data)
                });
            }))
            .then((data) => new Promise((resolve, reject) => {

                csv.parse(data, {
                    columns: true
                }, (err, rows) => {
                    if (err) reject(err);
                    resolve(rows);
                });
            }))
            // ... and make sure the rows are sane
            .then((rows) => {

                assert(rows.length >= 2);

                let foundSample = false;
                for (let i = 0; i < rows.length; ++i) {
                    let row = rows[i];
                    if (row['ID'] != 'ID') continue;

                    foundSample = true;
                    assert.equal(row['Title'], "TITLE");
                    assert.equal(row['Section'], "section");
                }

                assert(foundSample);
            });
    });

    it('should roundtrip correctly', () => {

        let outputFile = path.join(tmpDir, 'output.csv');
        let outputDir = path.join(tmpDir, 'output');

        return trio
            // Read sample tests
            .readTestDir(sampleDir)
            // Write test CSV
            .then(readTestFiles => trio.saveToTrCsv(readTestFiles, outputFile))
            // Read written test CSV
            .then(() => trio.readTestCsv(outputFile))
            // Write new sample test files
            .then(testRows => trio.saveToTestDir(testRows, outputDir))
            // Read new sample test file
            .then(() => trio.readTestFile(path.join(outputDir, 'section', 'TITLE.test.txt'), outputDir))
            // Make sure it's the same as the original sample file data
            .then(readTestFile => {

                let row = trio.trRowFor(readTestFile);
                assert.equal(row['ID'], "ID");
                assert.equal(row['Title'], "TITLE");
                assert.equal(row['Steps'], "STEPS");
                assert.equal(row['Expected Result'], "RESULT\n\nRESULT");

                assert.equal(row['Section'], "section");
                assert.equal(row['Section Hierarchy'], "section");
            });
    });

});