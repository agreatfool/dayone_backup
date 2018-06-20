#!/usr/bin/env node

import * as LibFs from 'mz/fs';
import * as LibOs from 'os';
import * as LibPath from 'path';
import * as LibUtil from 'util';

import * as extract from 'extract-zip';
import * as moment from 'moment';
import * as program from 'commander';
import * as removeValue from 'remove-value';
import * as rimraf from 'rimraf';
import * as mkdir from 'mkdirp';
import * as copydir from 'copy-dir';
import * as sqlite3 from 'sqlite3';
import * as targz from 'targz';

interface TargzOptions {
    src: string;
    dest: string;
    gz: {
        level: number;
        memLevel: number;
    }
}

const extractp = LibUtil.promisify(extract) as (zipPath: string, opts: extract.Options) => void;
const rimrafp = LibUtil.promisify(rimraf) as (path: string, options?: rimraf.Options) => void;
const mkdirp = LibUtil.promisify(mkdir) as (path: string) => void;
const copydirp = LibUtil.promisify(copydir) as (fromPath: string, toPath: string, filter: (stat: 'file' | 'directory', filepath: string, filename: string) => void) => void;
const targzp = LibUtil.promisify(targz.compress) as (options: TargzOptions) => void;

const pkg = require('../package.json');

const DAYONE_DIR = LibPath.join(LibOs.homedir(), '/Library/Group Containers/5U8NS4GX82.dayoneapp2');
const DAYONE_DOCUMENTS = LibPath.join(DAYONE_DIR, 'Data/Documents');
const DAYONE_PHOTOS_NAME = 'DayOnePhotos';
const DAYONE_PHOTOS = LibPath.join(DAYONE_DOCUMENTS, DAYONE_PHOTOS_NAME);
const DAYONE_DEFAULT_BACKUP_FILE_NAME = 'DayOneBackup.zip';

const BACKUP_LIMIT = 5;
const BACKUP_DIR_NAME = 'Dayone2Backup';
const BACKUP_TMP_DIR = '/tmp/dayone_tmp';

interface EntryRow {
    ZGREGORIANYEAR: number;
    ZGREGORIANMONTH: number;
    ZGREGORIANDAY: number;
    ZTEXT: string;
}

const LATEST_ENTRY_SQL = `SELECT ZGREGORIANYEAR, ZGREGORIANMONTH, ZGREGORIANDAY, ZTEXT FROM ZENTRY WHERE ZGREGORIANYEAR >=${(new Date()).getFullYear()} ORDER BY ZGREGORIANMONTH DESC, ZGREGORIANDAY DESC LIMIT 3;`;

program.version(pkg.version)
    .description('Dayone2 backup application, supports only MacOS & Dayone2')
    .option('-d, --dest <dir>', 'directory of backup destination')
    .option('-n, --dir_name <string>', `directory name of backup files: $dest/$name/backup_files, default is "${BACKUP_DIR_NAME}"`)
    .option('-m, --max_backups <number>', `max history backups remained, default is ${BACKUP_LIMIT}`)
    .parse(process.argv);

const BACKUP_DEST = (program as any).dest === undefined ? undefined : (program as any).dest;
const BACKUP_NAME = (program as any).dir_name === undefined ? BACKUP_DIR_NAME : (program as any).dir_name;
const BACKUP_MAX_COUNT = (program as any).max_backups === undefined ? BACKUP_LIMIT : parseInt((program as any).max_backups);

class DayOneBackup {

    private _backupDest: string = '';

    public async run() {
        console.log('Backup starting ...');

        await this._validate();
        await this._backup();
    }

    private async _validate() {
        console.log('Backup validating ...');

        if (!BACKUP_DEST) {
            console.log('No destination specified!');
            process.exit(1);
        }
        if (!(await LibFs.stat(BACKUP_DEST)).isDirectory()) {
            console.log('Destination is not a directory!');
            process.exit(1);
        }
        if (LibOs.platform() !== 'darwin') {
            console.log('Only MacOS supported!');
            process.exit(1);
        }
        if (!(await LibFs.stat(DAYONE_DIR)).isDirectory()) {
            console.log(`No Dayone2 data found, files shall be: ${DAYONE_DIR}`);
            process.exit(1);
        }
    }

    private async _backup() {
        await this._prepareBackupSource();
        await this._prepareBackupDest();
        await this._backupFiles();
        await this._displayLatestEntry();
    }

    private async _prepareBackupSource() {
        console.log('Preparing backup source ...');

        const tmpFile = LibPath.join('/tmp', DAYONE_DEFAULT_BACKUP_FILE_NAME);

        await LibFs.copyFile(LibPath.join(DAYONE_DOCUMENTS, DAYONE_DEFAULT_BACKUP_FILE_NAME), tmpFile);
        await extractp(tmpFile, {dir: BACKUP_TMP_DIR});

        console.log(`Backup source prepared: ${BACKUP_TMP_DIR}`);
    }

    private async _prepareBackupDest() {
        console.log('Preparing backup destination ...');

        const backupDestBase = LibPath.join(BACKUP_DEST, BACKUP_NAME);
        const currentBackupFolder = moment().format('YYYYMMDD_HHmmss');

        this._backupDest = LibPath.join(backupDestBase, currentBackupFolder);

        if (!(await LibFs.exists(backupDestBase))) {
            // even base destination does not exist
            await mkdirp(LibPath.join(this._backupDest));
        } else {
            // base destination exists, check sub dir count
            const existingBackups = removeValue(await LibFs.readdir(backupDestBase), '.DS_Store');

            let deleteTargets = [];
            if (existingBackups.length >= BACKUP_MAX_COUNT) {
                const delta = existingBackups.length - BACKUP_MAX_COUNT + 1; // +1: also leave the room for new backup
                deleteTargets = existingBackups.slice(0, delta); // remove old backups
            }

            for (let deleteTarget of deleteTargets) {
                const deleteTargetFullPath = LibPath.join(backupDestBase, deleteTarget);
                await rimrafp(deleteTargetFullPath);
                console.log(`Old backup deleted: ${deleteTargetFullPath}`);
            }

            await mkdirp(this._backupDest);
        }

        console.log(`Backup destination generated: ${this._backupDest}`);
    }

    private async _backupFiles() {
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
            await LibFs.copyFile(LibPath.join(DAYONE_DOCUMENTS, file), LibPath.join(this._backupDest, file));
        }
        console.log('DB files done ...');

        const photosBackupPath = LibPath.join(this._backupDest, DAYONE_PHOTOS_NAME);

        await copydirp(DAYONE_PHOTOS, photosBackupPath, (stat: 'file' | 'directory', filepath: string, filename: string) => {
            if (filename === '.DS_Store') {
                return false;
            }
            return true;
        });
        console.log('Photo files copied, start packing & compressing photo files ...');

        await targzp({
            src: photosBackupPath,
            dest: photosBackupPath + '.tar.gz',
            gz: {
                level: 9,
                memLevel: 9
            }
        });
        console.log('Photo tar file done ...');

        await rimrafp(photosBackupPath);
        console.log('Tmp photo files cleared ...');
    }

    private async _displayLatestEntry() {
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
                    const latest = row as EntryRow;
                    const text = latest.ZTEXT.length > maxTextLength ? latest.ZTEXT.substr(0, maxTextLength) + '...' : latest.ZTEXT;
                    console.log(`----------\nEntry, Date: ${latest.ZGREGORIANYEAR}-${latest.ZGREGORIANMONTH}-${latest.ZGREGORIANDAY}\nText: '${text}'`);
                });
            });

            db.close();
        });
    }

}

new DayOneBackup().run().then(_ => _).catch(_ => console.log(_));

process.on('uncaughtException', (error) => {
    console.error(`Process on uncaughtException error = ${error.stack}`);
});

process.on('unhandledRejection', (error) => {
    console.error(`Process on unhandledRejection error = ${error.stack}`);
});