'use strict'

import { setup, format, failAfterError } from '../lib/gulp-eslint.js'
import vfs from 'vinyl-fs'

// Function to lint files using ESLint directly
export default (files) => (done) =>
  vfs
    .src(files)
    .pipe(setup())
    .pipe(format())
    .pipe(failAfterError())
    .on('error', done)
