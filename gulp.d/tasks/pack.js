'use strict'

import ospath from 'path'
import vfs from 'vinyl-fs'
import zip from '../lib/zip.js'

export default (src, dest, bundleName, onFinish) => () =>
  vfs
    .src('**/*', { base: src, cwd: src, dot: true })
    .pipe(zip.dest(ospath.join(dest, `${bundleName}-bundle.zip`)))
    .on('finish', () => onFinish && onFinish(ospath.resolve(dest, `${bundleName}-bundle.zip`)))
