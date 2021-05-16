#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const LibFs = require("mz/fs");
const LibOs = require("os");
const LibPath = require("path");
const LibUtil = require("util");
const extract = require("extract-zip");
const moment = require("moment");
const program = require("commander");
const removeValue = require("remove-value");
const rimraf = require("rimraf");
const mkdir = require("mkdirp");
const copydir = require("copy-dir");
const sqlite3 = require("sqlite3");
const targz = require("targz");
const extractp = LibUtil.promisify(extract);
const rimrafp = LibUtil.promisify(rimraf);
const mkdirp = LibUtil.promisify(mkdir);
const copydirp = LibUtil.promisify(copydir);
const targzp = LibUtil.promisify(targz.compress);
const pkg = require('../package.json');
const DAYONE_DIR = LibPath.join(LibOs.homedir(), '/Library/Group Containers/5U8NS4GX82.dayoneapp2');
const DAYONE_DOCUMENTS = LibPath.join(DAYONE_DIR, 'Data/Documents');
const DAYONE_PHOTOS_NAME = 'DayOnePhotos';
const DAYONE_PHOTOS = LibPath.join(DAYONE_DOCUMENTS, DAYONE_PHOTOS_NAME);
const DAYONE_DEFAULT_BACKUP_FILE_NAME = 'DayOneBackup.zip';
const BACKUP_LIMIT = 5;
const BACKUP_DIR_NAME = 'Dayone2Backup';
const BACKUP_TMP_DIR = '/tmp/dayone_tmp';
const LATEST_ENTRY_SQL = `SELECT ZGREGORIANYEAR, ZGREGORIANMONTH, ZGREGORIANDAY, ZMARKDOWNTEXT FROM ZENTRY WHERE ZGREGORIANYEAR >=${(new Date()).getFullYear()} ORDER BY ZGREGORIANMONTH DESC, ZGREGORIANDAY DESC LIMIT 3;`;
program.version(pkg.version)
    .description('Dayone2 backup application, supports only MacOS & Dayone2')
    .option('-d, --dest <dir>', 'directory of backup destination')
    .option('-n, --dir_name <string>', `directory name of backup files: $dest/$name/backup_files, default is "${BACKUP_DIR_NAME}"`)
    .option('-m, --max_backups <number>', `max history backups remained, default is ${BACKUP_LIMIT}`)
    .parse(process.argv);
const BACKUP_DEST = program.dest === undefined ? undefined : program.dest;
const BACKUP_NAME = program.dir_name === undefined ? BACKUP_DIR_NAME : program.dir_name;
const BACKUP_MAX_COUNT = program.max_backups === undefined ? BACKUP_LIMIT : parseInt(program.max_backups);
class DayOneBackup {
    constructor() {
        this._backupDest = '';
    }
    run() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Backup starting ...');
            yield this._validate();
            yield this._backup();
        });
    }
    _validate() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Backup validating ...');
            if (!BACKUP_DEST) {
                console.log('No destination specified!');
                process.exit(1);
            }
            if (!(yield LibFs.stat(BACKUP_DEST)).isDirectory()) {
                console.log('Destination is not a directory!');
                process.exit(1);
            }
            if (LibOs.platform() !== 'darwin') {
                console.log('Only MacOS supported!');
                process.exit(1);
            }
            if (!(yield LibFs.stat(DAYONE_DIR)).isDirectory()) {
                console.log(`No Dayone2 data found, files shall be: ${DAYONE_DIR}`);
                process.exit(1);
            }
        });
    }
    _backup() {
        return __awaiter(this, void 0, void 0, function* () {
            // await this._prepareBackupSource();
            yield this._prepareBackupDest();
            yield this._backupFiles();
            yield this._displayLatestEntry();
        });
    }
    /**
     * @deprecated
     */
    _prepareBackupSource() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Preparing backup source ...');
            const tmpFile = LibPath.join('/tmp', DAYONE_DEFAULT_BACKUP_FILE_NAME);
            yield LibFs.copyFile(LibPath.join(DAYONE_DOCUMENTS, DAYONE_DEFAULT_BACKUP_FILE_NAME), tmpFile);
            yield extractp(tmpFile, { dir: BACKUP_TMP_DIR });
            console.log(`Backup source prepared: ${BACKUP_TMP_DIR}`);
        });
    }
    _prepareBackupDest() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Preparing backup destination ...');
            const backupDestBase = LibPath.join(BACKUP_DEST, BACKUP_NAME);
            const currentBackupFolder = moment().format('YYYYMMDD_HHmmss');
            this._backupDest = LibPath.join(backupDestBase, currentBackupFolder);
            if (!(yield LibFs.exists(backupDestBase))) {
                // even base destination does not exist
                yield mkdirp(LibPath.join(this._backupDest));
            }
            else {
                // base destination exists, check sub dir count
                const existingBackups = removeValue(yield LibFs.readdir(backupDestBase), '.DS_Store');
                let deleteTargets = [];
                if (existingBackups.length >= BACKUP_MAX_COUNT) {
                    const delta = existingBackups.length - BACKUP_MAX_COUNT + 1; // +1: also leave the room for new backup
                    deleteTargets = existingBackups.slice(0, delta); // remove old backups
                }
                for (let deleteTarget of deleteTargets) {
                    const deleteTargetFullPath = LibPath.join(backupDestBase, deleteTarget);
                    yield rimrafp(deleteTargetFullPath);
                    console.log(`Old backup deleted: ${deleteTargetFullPath}`);
                }
                yield mkdirp(this._backupDest);
            }
            console.log(`Backup destination generated: ${this._backupDest}`);
        });
    }
    _backupFiles() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Backup files ...');
            /**
             * UPDATE 2018-06-20
             * This logic has been changed, no longer using DayOneBackup.zip as the backup db source file.
             * Since it always has some delay. Now using Document/*.sqlite directly.
            const backupFileList = {
                // from => to
                'DayOneBackup.sqlite': 'DayOne.sqlite',
                'DayOneBackup.sqlite-wal': 'DayOne.sqlite-wal'
            };
    
            for (let sourceFile in backupFileList) {
                if (!backupFileList.hasOwnProperty(sourceFile)) {
                    continue;
                }
                let destFile = backupFileList[sourceFile];
    
                await LibFs.copyFile(LibPath.join(BACKUP_TMP_DIR, sourceFile), LibPath.join(this._backupDest, destFile));
            }
            console.log('DB files done ...');
            */
            const backupFileList = [
                'DayOne.sqlite',
                'DayOne.sqlite-shm',
                'DayOne.sqlite-wal',
                'DayOne.sqlite.dayonelock'
            ];
            for (let file of backupFileList) {
                console.log(LibPath.join(DAYONE_DOCUMENTS, file), LibPath.join(this._backupDest, file));
                yield LibFs.copyFile(LibPath.join(DAYONE_DOCUMENTS, file), LibPath.join(this._backupDest, file));
            }
            console.log('DB files done ...');
            const photosBackupPath = LibPath.join(this._backupDest, DAYONE_PHOTOS_NAME);
            yield copydirp(DAYONE_PHOTOS, photosBackupPath, (stat, filepath, filename) => {
                return filename !== '.DS_Store';
            });
            console.log('Photo files copied, start packing & compressing photo files ...');
            yield targzp({
                src: photosBackupPath,
                dest: photosBackupPath + '.tar.gz',
                gz: {
                    level: 9,
                    memLevel: 9
                }
            });
            console.log('Photo tar file done ...');
            yield rimrafp(photosBackupPath);
            console.log('Tmp photo files cleared ...');
        });
    }
    _displayLatestEntry() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Loading backup db: ', LibPath.join(this._backupDest, 'DayOne.sqlite'));
            let db = new sqlite3.Database(LibPath.join(this._backupDest, 'DayOne.sqlite'), (err) => {
                if (err) {
                    console.log(err);
                }
                console.log('DB connected, Read latest 3 entries: ');
                db.all(LATEST_ENTRY_SQL, [], (err, rows) => {
                    if (err) {
                        throw err;
                    }
                    const maxTextLength = 50;
                    rows.forEach((row) => {
                        const latest = row;
                        const text = latest.ZMARKDOWNTEXT.length > maxTextLength ? latest.ZMARKDOWNTEXT.substr(0, maxTextLength) + '...' : latest.ZMARKDOWNTEXT;
                        console.log(`----------\nEntry, Date: ${latest.ZGREGORIANYEAR}-${latest.ZGREGORIANMONTH}-${latest.ZGREGORIANDAY}\nText: '${text}'`);
                    });
                });
                db.close();
            });
        });
    }
}
new DayOneBackup().run().then(_ => _).catch(_ => console.log(_));
process.on('uncaughtException', (error) => {
    console.error(`Process on uncaughtException error = ${error.stack}`);
});
process.on('unhandledRejection', (error) => {
    console.error(`Process on unhandledRejection error`, error);
});
//# sourceMappingURL=index.js.map