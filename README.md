# TestRails Import Tool

Tool to allow import and export of Manual .txt-file tests into and out of TestRail.

## Quickstart

```
> npm install oaf-testrails-io@TODO
> [node] ./node_modules/oaf-testrails-io/index.js --help
```

### Write TestRail `.csv` example

```
> [node] ./node_modules/oaf-testrails-io/index.js \
    ./Tests/ManualTests \
    ./Tests/ManualTests/for-testrails.csv
```

### Write `.test.txt` files from TestRail .csv export example

```
> [node] ./node_modules/oaf-testrails-io/index.js \
    --import \
    ./Tests/ManualTests \
    ~/Downloads/exported-from-testrails.csv
```

## Developers

Basic unit tests are run using `mocha`:
```
> npm test
```

... and autostyling can be done using `js-beautify`, scripted as:
```
> npm run-script style *.js
```