'use strict'

import stylelint from 'gulp-stylelint'
import vfs from 'vinyl-fs'

export default (files) => (done) =>
  vfs
    .src(files)
    .pipe(stylelint({ reporters: [{ formatter: 'string', console: true }], failAfterError: true }))
    .on('error', done)
