'use strict'

hexo.extend.filter.register('after_render:html', html => {
  return html.replace(/<script type="application\/ld\+json">\s*<\/script>/g, '')
})
