#!/usr/bin/env node

const program = require('commander');
const fs = require('fs');
const fsUtils = require('nodejs-fs-utils');
const git = require('simple-git')('.');

function fileToTestRails(path, stats) {

    return new Promise((resolve, reject) => {

        console.log(path);
        console.log(stats);

        fs.readFile(path, 'utf8', (err,data) => {
            if (err) reject(err);
            
            git.log(['-1', '--format="%ad"', '--', path], (err, log) => {
                if (err) reject(err);

                resolve(data, log);
            });
        });
    });
}

function dirToTestRails(testDir) {

    return new Promise((resolve, reject) => {
        
        let reads = [];
        let trObjs = {};

        fsUtils.walk(testDir, (err, path, stats, next, cache) => {
            if (err) next();

            if (!next) {
                Promise.all(reads).then(() => resolve(trObjs));
                return;
            }

            if (!stats.isDirectory()) {
                reads.push(
                    fileToTestRails(path, stats)
                        .then((data, log) => { trObjs[path] = log; }));
            }

            next();
        });
    });
}

function saveToFile(trObjs, outputFile) {

    return new Promise((resolve, reject) => {

        console.log("Saving: ", JSON.stringify(trObjs), " to ", outputFile);

        fs.writeFile(outputFile, JSON.stringify(trObjs), err => {
            if (err) reject(err);
            else resolve();
        });
    });
}

program
    .arguments('<test-dir> <output-file>')
    //.option('-u, --username <username>', 'The user to authenticate as')
    //.option('-p, --password <password>', 'The user\'s password')
    .action(function (testDir, outputFile) {
        dirToTestRails(testDir)
            .then(trObjs => saveToFile(trObjs, outputFile))
            .then(() => console.log("DONE!"));
     })
    .parse(process.argv);

