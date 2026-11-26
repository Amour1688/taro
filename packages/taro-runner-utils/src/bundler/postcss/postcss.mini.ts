import { recursiveMerge } from '@tarojs/helper'

import postcssAlias from './postcss-alias'
import { createGetPostcssPlugins } from './postcss-plugins'

import type { Func, IHtmlTransformOption, IPostcssOption } from '@tarojs/taro/types/compile'

const defaultAutoprefixerOption = {
  enable: true,
  config: {
    flexbox: 'no-2009'
  }
}

const defaultUrlOption: {
  [key: string]: any
} = {
  enable: true,
  config: {
    url: 'inline'
  }
}

export const getDefaultPostcssConfig = function ({
  designWidth,
  deviceRatio,
  postcssOption = {} as IPostcssOption<'mini'>,
  alias = {},
  platform = process.env.TARO_ENV
}: {
  designWidth?: any
  deviceRatio?: any
  postcssOption?: IPostcssOption<'mini'>
  alias?: Record<string, any>
  platform?: string
}): [string, any, Func?][] {
  const { autoprefixer, pxtransform, htmltransform, ...options } = postcssOption

  const defaultPxtransformOption: { [key: string]: any } = {
    enable: true,
    config: {
      ...(platform ? { platform } : {}),
      ...(designWidth ? { designWidth } : {}),
      ...(deviceRatio ? { deviceRatio } : {})
    }
  }
  const defaultHtmltransformOption: IHtmlTransformOption = {
    enable: false,
    config: {
      ...(platform ? { platform } : {}),
      removeCursorStyle: true
    }
  }

  const autoprefixerOption = recursiveMerge({}, defaultAutoprefixerOption, autoprefixer)
  const pxtransformOption = recursiveMerge({}, defaultPxtransformOption, pxtransform)
  const htmltransformOption: IHtmlTransformOption = recursiveMerge({}, defaultHtmltransformOption, htmltransform)

  return [
    ['postcss-import', {}, require('postcss-import')],
    ['autoprefixer', autoprefixerOption, require('autoprefixer')],
    ['postcss-pxtransform', pxtransformOption, require('postcss-pxtransform')],
    ['postcss-alias', { config: { alias } }, postcssAlias],
    ['postcss-url', { ...defaultUrlOption, ...(options?.url || {}) }, require('postcss-url')],
    ['postcss-html-transform', htmltransformOption, require('postcss-html-transform')],
    ...Object.entries(options)
  ]
}

export const getPostcssPlugins = createGetPostcssPlugins(pluginName => `缺少postcss插件${pluginName}, 已忽略`)
