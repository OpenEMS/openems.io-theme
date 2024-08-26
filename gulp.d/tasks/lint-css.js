'use strict'

import stylelint from '../lib/gulp-stylelint.js'
import vfs from 'vinyl-fs'

export default (files) => (done) =>
  vfs
    .src(files)
    .pipe(stylelint({ reporters: [{ formatter: 'string', console: true }], failAfterError: true }))
    .on('error', done)
