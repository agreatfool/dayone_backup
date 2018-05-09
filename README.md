Day One2 Backup
================

Backup Day One2 data. Only MacOS & Day One2 supported.

## Install
```
npm install -g dayone_backup
```

## How to use
```
dayone-backup -h

  Usage: dayone-backup [options]

  Dayone2 backup application, supports only MacOS & Dayone2

  Options:

    -V, --version              output the version number
    -d, --dest <dir>           directory of backup destination
    -n, --dir_name<string>     directory name of backup files: $dest/$name/backup_files, default is "Dayone2Backup"
    -m, --max_backups<number>  max history backups remained, default is 5
    -h, --help                 output usage information
```

```
# backup to ~/Dropbox, and use default dir name, and keep only 1 backups
dayone-backup -d ~/Dropbox -m 1
```

## Actually done
```
DB File:
/Users/???/Library/Group Containers/5U8NS4GX82.dayoneapp2/Data/Documents/DayOneBackup.zip
=>
/private/tmp/DayOneBackup.zip
=>
/private/tmp/dayone_tmp/DayOneBackup.sqlite
=>
/${Dest}/${$BackupName}/DayOne.sqlite

Photos:
/Users/???/Library/Group Containers/5U8NS4GX82.dayoneapp2/Data/Documents/DayOnePhotos/
=>
/${Dest}/${$BackupName}/DayOnePhotos.tar.gz
```