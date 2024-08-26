'use strict'

import PluginError from 'plugin-error'
import through from 'through2'
import stylelint from 'stylelint'
import fancyLog from 'fancy-log'
import { SourceMapConsumer } from 'source-map'

const { lint, formatters } = stylelint

//const applySourcemap = require('./apply-sourcemap')
//const reporterFactory = require('./reporter-factory')

/**
 * Name of this plugin for reporting purposes.
 * @type {String}
 */
const pluginName = 'gulp-stylelint'

/**
 * Stylelint results processor.
 * @param {Object} [options] - Plugin options.
 * @param {String} [options.reportOutputDir] - Common path for all reporters.
 * @param {[Object]} [options.reporters] - Reporter configurations.
 * @param {Boolean} [options.failAfterError] - If true, the process will end with non-zero error code if any error was raised.
 * @param {Boolean} [options.debug] - If true, error stack will be printed.
 * @return {Stream} Object stream usable in Gulp pipes.
 */
export default function gulpStylelint (options) {
  /**
   * Plugin options with defaults applied.
   * @type Object
   */
  const pluginOptions = Object.assign(
    {
      failAfterError: true,
      debug: false,
    },
    options
  )

  /**
   * Lint options for stylelint's `lint` function.
   * @type Object
   */
  const lintOptions = Object.assign({}, options)

  /**
   * List of gulp-stylelint reporters.
   * @type [Function]
   */
  const reporters = (pluginOptions.reporters || []).map((config) => reporterFactory(config, pluginOptions))

  /**
   * List of stylelint's lint result promises.
   * @type [Promise]
   */
  const lintPromiseList = []

  // Remove the stylelint options that cannot be used:
  delete lintOptions.files // css code will be provided by gulp instead
  delete lintOptions.formatter // formatters are defined in the `reporters` option
  delete lintOptions.cache // gulp caching should be used instead

  // Remove gulp-stylelint options so that they don't interfere with stylelint options:
  delete lintOptions.reportOutputDir
  delete lintOptions.reporters
  delete lintOptions.debug

  /**
   * Launches linting of a given file, pushes promises to the promise list.
   *
   * Note that the files are not modified and are pushed
   * back to their pipes to allow usage of other plugins.
   *
   * @param {File} file - Piped file.
   * @param {String} encoding - File encoding.
   * @param {Function} done - File pipe completion callback.
   * @return {undefined} Nothing is returned (done callback is used instead).
   */
  function onFile (file, encoding, done) {
    if (file.isNull()) {
      done(null, file)

      return
    }

    if (file.isStream()) {
      this.emit('error', new PluginError(pluginName, 'Streaming is not supported'))
      done()

      return
    }

    const localLintOptions = Object.assign({}, lintOptions, {
      code: file.contents.toString(),
      codeFilename: file.path,
    })

    const lintPromise = lint(localLintOptions)
      .then(
        (lintResult) =>
          // Checking for the presence of sourceMap.mappings
          // in case sourcemaps are initialized, but still empty:
          file.sourceMap && file.sourceMap.mappings ? applySourcemap(lintResult, file.sourceMap) : lintResult
      )
      .then((lintResult) => {
        if (lintOptions.fix && lintResult.output) {
          file.contents = Buffer.from(lintResult.output)
        }

        done(null, file)

        return lintResult
      })
      .catch((error) => {
        done(null, file)

        return Promise.reject(error)
      })

    lintPromiseList.push(lintPromise)
  }

  /**
   * Provides Stylelint result to reporters.
   * @param {[Object]} lintResults - Stylelint results.
   * @return {Promise} Resolved with original lint results.
   */
  function passLintResultsThroughReporters (lintResults) {
    const warnings = lintResults.flatMap((result) => result.results)

    return Promise.all(reporters.map((reporter) => reporter.then((rep) => rep).then((rep) => rep(warnings)))).then(
      () => lintResults
    )
  }

  /**
   * Determines if the severity of a stylelint warning is "error".
   * @param {Object} warning - Stylelint results warning.
   * @return {Boolean} True if warning's severity is "error", false otherwise.
   */
  function isErrorSeverity (warning) {
    return warning.severity === 'error'
  }

  /**
   * Resolves promises and provides accumulated report to reporters.
   * @param {Function} done - Stream completion callback.
   * @return {undefined} Nothing is returned (done callback is used instead).
   */
  function onStreamEnd (done) {
    Promise.all(lintPromiseList)
      .then(passLintResultsThroughReporters)
      .then((lintResults) => {
        process.nextTick(() => {
          // if the file was skipped, for example, by .stylelintignore, then res.results will be []
          const errorCount = lintResults
            .filter((res) => res.results.length)
            .reduce((sum, res) => {
              return sum + res.results[0].warnings.filter(isErrorSeverity).length
            }, 0)

          if (pluginOptions.failAfterError && errorCount > 0) {
            this.emit(
              'error',
              new PluginError(pluginName, `Failed with ${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`)
            )
          }

          done()
        })
      })
      .catch((error) => {
        process.nextTick(() => {
          this.emit(
            'error',
            new PluginError(pluginName, error, {
              showStack: Boolean(pluginOptions.debug),
            })
          )
          done()
        })
      })
  }

  return through.obj(onFile, onStreamEnd).resume()
}

/**
 * Creates a reporter from the given config.
 * @param {Object} [config] - Reporter config.
 * @param {Object} [options] - Plugin options.
 * @return {Function} Reporter.
 */
async function reporterFactory (config = {}, options = {}) {
  /**
   * Formatter for stylelint results.
   *
   * User has a choice of passing a custom formatter function,
   * or a name of formatter bundled with stylelint by default.
   *
   * @type {Function}
   */
  let formatter

  if (typeof config.formatter === 'string') {
    formatter = await stylelint.formatters[config.formatter]
  } else {
    formatter = config.formatter
  }

  if (typeof formatter !== 'function') {
    throw new TypeError(`Formatter "${formatter}" is not a function`)
  }

  /**
   * Reporter.
   * @param {[Object]} results - Array of stylelint results.
   * @return {Promise} Resolved when writer and logger are done.
   */
  return (results) => {
    /**
     * Async tasks performed by the reporter.
     * @type [Promise]
     */
    const asyncTasks = []

    /**
     * Formatter output.
     * @type String
     */
    if (config.console) {
      const formattedText = formatter(results, {})
      if (formattedText.trim()) {
        asyncTasks.push(fancyLog.info(`\n${formattedText}\n`))
      }
    }

    return Promise.all(asyncTasks)
  }
}

function applySourcemap (lintResult, sourceMap) {
  const sourceMapConsumer = new SourceMapConsumer(sourceMap)

  lintResult.results = lintResult.results.reduce((memo, result) => {
    if (result.warnings.length) {
      result.warnings.forEach((warning) => {
        const origPos = sourceMapConsumer.originalPositionFor(warning)
        const sameSourceResultIndex = memo.findIndex((r) => r.source === origPos.source)

        warning.line = origPos.line
        warning.column = origPos.column

        if (sameSourceResultIndex === -1) {
          memo.push(
            Object.assign({}, result, {
              source: origPos.source,
              warnings: [warning],
            })
          )
        } else {
          memo[sameSourceResultIndex].warnings.push(warning)
        }
      })
    } else {
      memo.push(result)
    }

    return memo
  }, [])

  // The consumer in versions ^0.7.0 of SourceMap need to be `destroy`ed after
  // usage, but the older don't, so we wrap it in a typeof for backwards compatibility:
  if (typeof sourceMapConsumer.destroy === 'function') {
    // Free this source map consumer's associated wasm data that is manually-managed:
    sourceMapConsumer.destroy()
  }

  return lintResult
}

/**
 * Formatters bundled with stylelint by default.
 *
 * User may want to see the list of available formatters,
 * proxy them or pass them as functions instead of strings.
 *
 * @see https://github.com/olegskl/gulp-stylelint/issues/3#issuecomment-197025044
 * @type {Object}
 */
export { formatters }
