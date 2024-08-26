let zip

try {
  zip = (await import('@vscode/gulp-vinyl-zip')).default
} catch {
  try {
    zip = (await import('gulp-vinyl-zip')).default
  } catch (error) {
    throw new Error("Neither '@vscode/gulp-vinyl-zip' nor 'gulp-vinyl-zip' could be imported.")
  }
}

export default zip
