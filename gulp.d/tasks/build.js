import autoprefixer from 'autoprefixer'
import concat from 'gulp-concat'
import cssnano from 'cssnano'
import fs from 'fs-extra'
import { globSync } from 'glob'
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
import webpack from 'webpack-stream'
/**
 * TODO: remove: fs.Stats constructor is deprecated. vinyl-fs 4.0.0 is the issue
 */
process.noDeprecation = true

const path = ospath.posix
const through = () => transform((file, enc, next) => next(null, file))

const svgoOpts = {
  plugins: [
    { name: 'cleanupIds', params: { preservePrefixes: ['icon-', 'view-'] } },
    { name: 'preset-default', params: { overrides: { removeViewBox: false, removeDesc: false } } },
  ],
}

function transform (transform) {
  return new Transform({
    objectMode: true,
    transform,
  })
}

const webpackConfigTemplate = {
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
          },
        },
      },
    ],
  },
  resolve: {
    extensions: ['.bundle.js'],
  },
  stats: {
    all: false,
  },
}

function webpackConfig (src, dest) {
  const entries = {}

  globSync(`${src}/**/*.bundle.js`).forEach((file) => {
    const relativePath = path.relative(src, file)
    const name = relativePath.replace(/\.bundle\.js$/, '')
    entries[name] = path.resolve(file)
  })

  return {
    ...webpackConfigTemplate,
    entry: entries,
    output: {
      path: path.resolve(dest, '[path]'),
      filename: '[name].js',
    },
  }
}

const filter = (regex) =>
  transform((file, encoding, callback) => {
    if (regex.test(file.path)) {
      callback()
    } else {
      callback(null, file)
    }
  })

export default (src, dest, preview) => () => {
  const opts = { base: src, cwd: src }
  const sourcemaps = preview || process.env.SOURCEMAPS === 'true'
  const imageminPlugins = [imageminGifsicle(), imageminMozjpeg(), imageminOptipng(), imageminSvgo(svgoOpts)]

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
    preview ? postcssCalc : () => {},
    autoprefixer,
    preview ? () => {} : cssnano({ preset: 'default' }),
    postcssPseudoElementFixer(),
  ]

  return merge(
    vfs.src('ui.yml', { ...opts, allowEmpty: true }),
    vfs
      .src('js/+([0-9])-*.js', { ...opts, read: false, sourcemaps })
      .pipe(filter(/.*.bundle.js/))
      .pipe(uglify({ output: { comments: /^! / } }))
      .pipe(concat('js/site.js')),
    vfs
      .src(['js/vendor/*.bundle.js'], { ...opts })
      .pipe(webpack(webpackConfig(src, dest)))
      .pipe(uglify({ output: { comments: /^! / } })),
    vfs
      .src('js/vendor/*.min.js', opts)
      .pipe(transform((file, enc, next) => next(null, Object.assign(file, { extname: '' }, { extname: '.js' })))),
    vfs
      .src(['css/site.css', 'css/vendor/*.css'], { ...opts, sourcemaps })
      .pipe(postcss((file) => ({ plugins: postcssPlugins, options: { file } }))),
    vfs.src('font/*.{ttf,woff*(2)}', opts),
    vfs
      .src('img/**/*.{gif,ico,jpg,png,svg}', opts)
      .pipe(preview ? through() : imagemin(imageminPlugins.reduce((accum, it) => (it ? accum.concat(it) : accum), []))),
    vfs.src('helpers/*.js', opts),
    vfs.src('layouts/*.hbs', opts),
    vfs.src('partials/*.hbs', opts),
    vfs.src('static/**/*[!~]', { ...opts, base: ospath.join(src, 'static'), dot: true })
  ).pipe(vfs.dest(dest, { sourcemaps: sourcemaps && '.' }))
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
