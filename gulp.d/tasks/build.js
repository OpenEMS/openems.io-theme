import autoprefixer from 'autoprefixer'
import browserify from 'browserify'
import concat from 'gulp-concat'
import cssnano from 'cssnano'
import fs from 'fs-extra'
import imagemin from 'gulp-imagemin'
import merge from 'merge-stream'
import ospath from 'path'
import postcss from 'gulp-postcss'
import postcssCalc from 'postcss-calc'
import postcssImport from 'postcss-import'
import postcssUrl from 'postcss-url'
import postcssVar from 'postcss-custom-properties'
import { Transform } from 'stream'
import uglify from 'gulp-uglify'
import vfs from 'vinyl-fs'
import imageminGifsicle from 'imagemin-gifsicle'
import imageminMozjpeg from 'imagemin-mozjpeg'
import imageminOptipng from 'imagemin-optipng'
import imageminSvgo from 'imagemin-svgo'

/**
 * TODO: remove
 * hide fs.Stats constructor is deprecated. vinyl-fs 4.0.0 is the issue
 */
process.noDeprecation = true

const path = ospath.posix
const through = () => transform((file, enc, next) => next(null, file))

const svgoOpts = {
  plugins: [
    {
      name: 'cleanupIds',
      params: { preservePrefixes: ['icon-', 'view-'] },
    },
    {
      name: 'preset-default',
      params: { overrides: { removeViewBox: false, removeDesc: false } },
    },
  ],
}

function transform (transform) {
  return new Transform({
    objectMode: true,
    transform,
  })
}

export default (src, dest, preview) => () => {
  const opts = { base: src, cwd: src }
  const sourcemaps = preview || process.env.SOURCEMAPS === 'true'
  const imageminPlugins = [
    imageminGifsicle(), imageminMozjpeg(), imageminOptipng(), imageminSvgo(svgoOpts),
  ]

  const postcssPlugins = [
    postcssImport,
    (css, { messages, opts: { file } }) =>
      Promise.all(
        messages
          .reduce((accum, { file: depPath, type }) => (type === 'dependency' ? accum.concat(depPath) : accum), [])
          .map((importedPath) => fs.stat(importedPath).then(({ mtime }) => mtime))
      ).then((mtimes) => {
        const newestMtime = mtimes.reduce((max, curr) => (!max || curr > max ? curr : max), file.stat.mtime)
        if (newestMtime > file.stat.mtime) file.stat.mtimeMs = +(file.stat.mtime = newestMtime)
      }),
    postcssUrl([
      {
        filter: (asset) => /^[~][^/]*(?:font|typeface)[^/]*\/.*\/files\/.+[.](?:ttf|woff2?)$/.test(asset.url),
        url: async (asset) => {
          const relpath = asset.pathname.slice(1)
          const abspath = ospath.resolve('node_modules', relpath)
          const basename = ospath.basename(abspath)
          const destpath = ospath.join(dest, 'font', basename)

          if (!fs.pathExistsSync(destpath)) {
            fs.copySync(abspath, destpath)
          }
          return path.join('..', 'font', basename)
        },
      },
    ]),
    postcssVar({ preserve: preview }),
    preview ? postcssCalc : () => {}, // cssnano already applies postcssCalc
    autoprefixer,
    preview
      ? () => {}
      : cssnano({ preset: 'default' }),
    postcssPseudoElementFixer(),
  ]

  return merge(
    vfs.src('ui.yml', { ...opts, allowEmpty: true }),
    vfs
      .src('js/+([0-9])-*.js', { ...opts, read: false, sourcemaps })
      .pipe(bundle(opts))
      .pipe(uglify({ output: { comments: /^! / } }))
      .pipe(concat('js/site.js')),
    vfs
      .src('js/vendor/+([^.])?(.bundle).js', { ...opts, read: false })
      .pipe(bundle(opts))
      .pipe(uglify({ output: { comments: /^! / } })),
    vfs
      .src('js/vendor/*.min.js', opts)
      .pipe(transform((file, enc, next) => next(null, Object.assign(file, { extname: '' }, { extname: '.js' })))),
    vfs
      .src(['css/site.css', 'css/vendor/*.css'], { ...opts, sourcemaps })
      .pipe(postcss((file) => ({ plugins: postcssPlugins, options: { file } }))),
    vfs.src('font/*.{ttf,woff*(2)}', opts),
    vfs.src('img/**/*.{gif,ico,jpg,png,svg}', opts)
      .pipe(preview
        ? through()
        : imagemin(imageminPlugins.reduce((accum, it) => (it ? accum.concat(it) : accum), []))
      ),
    vfs.src('helpers/*.js', opts),
    vfs.src('layouts/*.hbs', opts),
    vfs.src('partials/*.hbs', opts),
    vfs.src('static/**/*[!~]', { ...opts, base: ospath.join(src, 'static'), dot: true })
  ).pipe(vfs.dest(dest, { sourcemaps: sourcemaps && '.' }))
}

function bundle ({ base: basedir, ext: bundleExt = '.bundle.js' }) {
  return transform((file, enc, next) => {
    if (bundleExt && file.relative.endsWith(bundleExt)) {
      const mtimePromises = []
      const bundlePath = file.path
      browserify(file.relative, { basedir, detectGlobals: false })
        .plugin('browser-pack-flat/plugin')
        .on('file', (bundledPath) => {
          if (bundledPath !== bundlePath) mtimePromises.push(fs.stat(bundledPath).then(({ mtime }) => mtime))
        })
        .bundle((bundleError, bundleBuffer) =>
          Promise.all(mtimePromises).then((mtimes) => {
            const newestMtime = mtimes.reduce((max, curr) => (curr > max ? curr : max), file.stat.mtime)
            if (newestMtime > file.stat.mtime) file.stat.mtimeMs = +(file.stat.mtime = newestMtime)
            if (bundleBuffer !== undefined) file.contents = bundleBuffer
            next(bundleError, Object.assign(file, { path: file.path.slice(0, file.path.length - 10) + '.js' }))
          })
        )
      return
    }
    fs.readFile(file.path, 'UTF-8').then((contents) => {
      next(null, Object.assign(file, { contents: Buffer.from(contents) }))
    })
  })
}

const postcssPseudoElementFixer = () => {
  return {
    postcssPlugin: 'postcss-pseudo-element-fixer',
    Once (css) {
      css.walkRules(/(?:^|[^:]):(?:before|after)/, (rule) => {
        rule.selector = rule.selectors.map((it) => it.replace(/(^|[^:]):(before|after)$/, '$1::$2')).join(',')
      })
    },
  }
}

postcssPseudoElementFixer.postcss = true
