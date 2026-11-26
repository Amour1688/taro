import { createComponentConfig } from '@tarojs/runner-utils'

import type { IComponentConfig } from '@tarojs/taro/types/compile/hooks'

export const componentConfig: IComponentConfig = createComponentConfig()

export const elementNameSet = new Set<string>()
export const componentNameSet = new Set<string>()

export const TARO_ENTRY_QUERY_KEY = '__taro_entry__'

export function buildEntryRequestWithQuery (entryPath: string, entryName: string): string {
  const sep = entryPath.includes('?') ? '&' : '?'
  return `${entryPath}${sep}${TARO_ENTRY_QUERY_KEY}=${encodeURIComponent(entryName)}`
}

export function parseEntryNameFromQuery (resourceQuery = ''): string | null {
  if (!resourceQuery) return null
  const queryStr = resourceQuery.startsWith('?') ? resourceQuery.slice(1) : resourceQuery
  const params = new URLSearchParams(queryStr)
  return params.get(TARO_ENTRY_QUERY_KEY)
}
