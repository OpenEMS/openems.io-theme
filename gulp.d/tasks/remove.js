'use strict'

import fs from 'fs-extra'
import { Transform } from 'stream'
import vfs from 'vinyl-fs'

const map = (transform) => new Transform({ objectMode: true, transform })

export default (files) => () =>
  vfs.src(files, { allowEmpty: true }).pipe(map((file, enc, next) => fs.remove(file.path, next)))
