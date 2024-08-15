'use strict'

import { Transform } from 'stream'
import PluginError from 'plugin-error'
import { ESLint } from 'eslint'
import relative from 'path'
import fancyLog from 'fancy-log'

let linter = null

/**
 * Convenience method for creating a transform stream in object mode
 *
 * @param {Function} transform - An async function that is called for each stream chunk
 * @param {Function} [flush] - An async function that is called before closing the stream
 * @returns {stream} A transform stream
 */
function transform (transform, flush) {
  return new Transform({
    objectMode: true,
    transform,
    flush,
  })
}

/**
 * Mimic the CLIEngine's createIgnoreResult function,
 * only without the ESLint CLI reference.
 *
 * @param {Object} file - file with a "path" property
 * @returns {Object} An ESLint report with an ignore warning
 */
function createIgnoreResult (file) {
  return {
    filePath: file.path,
    messages: [{
      fatal: false,
      severity: 1,
      message: file.path.includes('node_modules/')
        ? 'File ignored because it has a node_modules/** path'
        : 'File ignored because of .eslintignore file',
    }],
    errorCount: 0,
    warningCount: 1,
  }
}

/**
 * Append ESLint result to each file
 *
 * @returns {stream} gulp file stream
 */
function eslint () {
  linter = new ESLint()

  return transform(async (file, enc, cb) => {
    const filePath = relative.join(process.cwd(), file.path)

    if (file.isNull()) {
      cb(null, file)
      return
    }

    if (file.isStream()) {
      cb(new PluginError('gulp-eslint', 'gulp-eslint doesn\'t support vinyl files with Stream contents.'))
      return
    }

    const ignored = await linter.isPathIgnored(filePath)
    if (ignored) {
      file.eslint = createIgnoreResult(file)
      cb(null, file)
      return
    }

    try {
      const result = await linter.lintText(file.contents.toString(), { filePath })
      file.eslint = result[0] // ESLint lintText returns an array of results
      if (file.eslint.output) {
        file.contents = Buffer.from(file.eslint.output)
        file.eslint.fixed = true
      }
      cb(null, file)
    } catch (e) {
      cb(new PluginError('gulp-eslint', e))
    }
  })
}

/**
 * Handle all ESLint results at the end of the stream.
 *
 * @param {Function} action - A function to handle all ESLint results
 * @returns {stream} gulp file stream
 */
function results (action) {
  const results = []
  results.errorCount = 0
  results.warningCount = 0

  return transform((file, enc, cb) => {
    if (file.eslint) {
      results.push(file.eslint)
      results.errorCount += file.eslint.errorCount
      results.warningCount += file.eslint.warningCount
    }
    cb(null, file)
  }, async (done) => {
    Promise.resolve(action(results)).then(() => done()).catch(done)
  })
}

/**
 * Fail when the stream ends if any ESLint error(s) occurred
 *
 * @returns {stream} gulp file stream
 */
eslint.failAfterError = () => {
  return results((results) => {
    if (results.errorCount > 0) {
      throw new PluginError('gulp-eslint',
        `Failed with ${results.errorCount} ${results.errorCount === 1 ? 'error' : 'errors'}`)
    }
  })
}

/**
 * Wait until all files have been linted and format all results at once.
 *
 * @returns {stream} gulp file stream
 */
eslint.format = () => {
  const formatterPromise = linter.loadFormatter()

  return results(async (results) => {
    if (results.length) {
      const message = (await formatterPromise).format(results)
      if (message) {
        fancyLog(message)
      }
    }
  })
}

export default eslint
