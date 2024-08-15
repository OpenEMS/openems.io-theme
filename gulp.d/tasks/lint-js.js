'use strict'

import lint from '../lib/gulp-eslint.js'
import vfs from 'vinyl-fs'

export default (files) => (done) =>
  vfs
    .src(files)
    .pipe(lint())
    .pipe(lint.format())
    .pipe(lint.failAfterError())
    .on('error', done)
