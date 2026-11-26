import type { Func } from '@tarojs/taro/types/compile'
import type { IComponentConfig } from '@tarojs/taro/types/compile/hooks'

export type ImportBindingKind = 'named' | 'namespace' | 'default'
export type ExportBindingKind = 'reexport' | 'local'

export interface ImportBindingMeta {
  kind: ImportBindingKind
  source: string
  imported?: string
}

export interface ExportBindingMeta {
  kind: ExportBindingKind
  source?: string
  imported?: string
  local?: string
}

export type UsedComponentRefMeta =
  | {
    kind: 'identifier'
    name: string
  }
  | {
    kind: 'member'
    object: string
    property: string
  }

export interface IModuleComponentMeta {
  elementNameSet: Set<string>
  componentNameSet: Set<string>
  collectProps: Record<string, string>
  importedBindings: Record<string, ImportBindingMeta>
  exportBindings: Record<string, ExportBindingMeta>
  exportAllSources: string[]
  usedComponentRefs: UsedComponentRefMeta[]
}

export type ComponentTypeRef =
  | { kind: 'element', name: string }
  | { kind: 'identifier', name: string }
  | { kind: 'member', object: string, property: string }

export interface ICollectModuleComponentMetaOptions {
  target?: IModuleComponentMeta
  componentConfig: IComponentConfig
  onParseCreateElement?: Func
}

export function createModuleComponentMeta (): IModuleComponentMeta {
  return {
    elementNameSet: new Set(),
    componentNameSet: new Set(),
    collectProps: {},
    importedBindings: {},
    exportBindings: {},
    exportAllSources: [],
    usedComponentRefs: []
  }
}

function getLiteralStringValue (node: any): string | undefined {
  if (!node) return
  if (typeof node.value === 'string') return node.value
}

function getIdentifierLikeName (node: any): string | undefined {
  if (!node) return

  if (node.type === 'Identifier') {
    return node.name
  }

  return getLiteralStringValue(node)
}

function getPropName (key: any): string | null {
  if (!key) return null
  return key.type === 'Identifier' ? key.name : (key.type === 'Literal' ? key.value : null)
}

function createWalkBase (walk: any) {
  return {
    ...(walk.base || {}),
    Import: walk.base?.Import || (() => {})
  }
}

function unwrapSequenceExpression (node: any): any {
  let current = node
  while (current?.type === 'SequenceExpression' && Array.isArray(current.expressions) && current.expressions.length > 0) {
    current = current.expressions[current.expressions.length - 1]
  }
  return current
}

function getRequireCallSource (node: any): string | undefined {
  if (node?.type !== 'CallExpression') return
  const callee = unwrapSequenceExpression(node.callee)
  if (callee?.type === 'Identifier' && callee.name === 'require') {
    return getLiteralStringValue(node.arguments?.[0])
  }
}

function getCalleeHelperName (callee: any): string {
  const unwrapped = unwrapSequenceExpression(callee)
  if (!unwrapped) return ''
  if (unwrapped.type === 'Identifier') return unwrapped.name || ''
  if (unwrapped.type === 'MemberExpression') {
    const propName = getIdentifierLikeName(unwrapped.property) || ''
    if (propName && propName !== 'default') return propName
    return getIdentifierLikeName(unwrapped.object) || ''
  }
  return ''
}

function getCjsRequireBinding (init: any): ImportBindingMeta | null {
  if (!init || init.type !== 'CallExpression') return null

  const directSource = getRequireCallSource(init)
  if (directSource) {
    return {
      kind: 'namespace',
      source: directSource
    }
  }

  const helperName = getCalleeHelperName(init.callee)
  if (!helperName) return null

  const wrappedSource = getRequireCallSource(init.arguments?.[0])
  if (!wrappedSource) return null

  if (/interopRequireWildcard/i.test(helperName)) {
    return {
      kind: 'namespace',
      source: wrappedSource
    }
  }

  if (/interopRequireDefault/i.test(helperName)) {
    return {
      kind: 'default',
      source: wrappedSource,
      imported: 'default'
    }
  }

  return null
}

export function isCreateElementCallee (rawCallee: any): boolean {
  const callee = unwrapSequenceExpression(rawCallee)
  if (!callee) return false

  if (callee.type === 'MemberExpression') {
    return callee.property?.type === 'Identifier' && (
      callee.property.name === 'createElement' ||
      /^_?jsx(s|DEV)?$/.test(callee.property.name)
    )
  }

  if (callee.type === 'Identifier') {
    const name = callee.name || ''
    return (
      // 兼容 react17 new jsx transform、dev _jsxDEV 以及 esbuild-loader 的 ast 兼容问题
      /^_?jsx(s|DEV)?$/.test(name) ||
      name === 'createElement' ||
      // 兼容 Vue 3.0 渲染函数及 JSX
      name.includes('createVNode') ||
      name.includes('createBlock') ||
      name.includes('createElementVNode') ||
      name.includes('createElementBlock') ||
      name.includes('resolveComponent') || // 收集使用解析函数的组件名称
      name.includes('_$createElement') // solidjs 创建元素
    )
  }

  return false
}

export function getComponentTypeRef (typeNode: any): ComponentTypeRef | null {
  if (!typeNode) return null

  if (typeof typeNode.value === 'string') {
    return {
      kind: 'element',
      name: typeNode.value
    }
  }

  if (typeNode.type === 'Identifier') {
    return {
      kind: 'identifier',
      name: typeNode.name
    }
  }

  if (typeNode.type === 'MemberExpression') {
    const objectName = getIdentifierLikeName(typeNode.object)
    const propertyName = typeNode.computed
      ? getLiteralStringValue(typeNode.property)
      : getIdentifierLikeName(typeNode.property)

    if (objectName && propertyName) {
      return {
        kind: 'member',
        object: objectName,
        property: propertyName
      }
    }
  }

  return null
}

export function collectModuleComponentMetaFromAst (
  ast: any,
  walk: any,
  options: ICollectModuleComponentMetaOptions
): IModuleComponentMeta {
  const { componentConfig, onParseCreateElement } = options
  const target = options.target || createModuleComponentMeta()

  walk.ancestor(ast, {
    ImportDeclaration: (node: any) => {
      const source = getLiteralStringValue(node.source)
      if (!source) return

      node.specifiers?.forEach((specifier: any) => {
        const localName = specifier.local?.name
        if (!localName) return

        if (specifier.type === 'ImportSpecifier') {
          target.importedBindings[localName] = {
            kind: 'named',
            source,
            imported: getIdentifierLikeName(specifier.imported) || localName
          }
        } else if (specifier.type === 'ImportNamespaceSpecifier') {
          target.importedBindings[localName] = {
            kind: 'namespace',
            source
          }
        } else if (specifier.type === 'ImportDefaultSpecifier') {
          target.importedBindings[localName] = {
            kind: 'default',
            source,
            imported: 'default'
          }
        }
      })
    },

    ExportNamedDeclaration: (node: any) => {
      const source = getLiteralStringValue(node.source)

      node.specifiers?.forEach((specifier: any) => {
        const exportedName = getIdentifierLikeName(specifier.exported)
        if (!exportedName) return

        if (source) {
          target.exportBindings[exportedName] = {
            kind: 'reexport',
            source,
            imported: getIdentifierLikeName(specifier.local) || exportedName
          }
        } else {
          target.exportBindings[exportedName] = {
            kind: 'local',
            local: getIdentifierLikeName(specifier.local) || exportedName
          }
        }
      })
    },

    ExportAllDeclaration: (node: any) => {
      const source = getLiteralStringValue(node.source)
      if (!source) return

      target.exportAllSources.push(source)
    },

    VariableDeclarator: (node: any) => {
      const binding = getCjsRequireBinding(node.init)
      if (!binding) return

      if (node.id?.type === 'Identifier' && node.id.name) {
        target.importedBindings[node.id.name] = binding
      } else if (node.id?.type === 'ObjectPattern' && binding.kind === 'namespace') {
        node.id.properties?.forEach((prop: any) => {
          if (prop.type !== 'Property') return
          const imported = getIdentifierLikeName(prop.key)
          const local = prop.value?.type === 'Identifier' ? prop.value.name : undefined
          if (local && imported) {
            target.importedBindings[local] = {
              kind: 'named',
              source: binding.source,
              imported
            }
          }
        })
      }
    },

    CallExpression: (node: any) => {
      if (!isCreateElementCallee(node.callee)) return

      const [type, prop] = node.arguments || []
      if (!type) return

      const componentTypeRef = getComponentTypeRef(type)
      if (!componentTypeRef) return

      if (componentTypeRef.kind === 'element') {
        const elementName = componentTypeRef.name
        onParseCreateElement?.(elementName, componentConfig)
        target.elementNameSet.add(elementName)
      } else if (componentTypeRef.kind === 'identifier') {
        const componentName = componentTypeRef.name
        target.componentNameSet.add(componentName)
        target.usedComponentRefs.push({
          kind: 'identifier',
          name: componentName
        })
        if (componentName === 'CustomWrapper' && !componentConfig.thirdPartyComponents.get('custom-wrapper')) {
          componentConfig.thirdPartyComponents.set('custom-wrapper', new Set())
        }
      } else if (componentTypeRef.kind === 'member') {
        target.usedComponentRefs.push({
          kind: 'member',
          object: componentTypeRef.object,
          property: componentTypeRef.property
        })
        if (componentTypeRef.property === 'CustomWrapper') {
          target.componentNameSet.add(componentTypeRef.property)
          if (!componentConfig.thirdPartyComponents.get('custom-wrapper')) {
            componentConfig.thirdPartyComponents.set('custom-wrapper', new Set())
          }
        }
      }

      if (componentConfig.thirdPartyComponents.size === 0 || componentTypeRef.kind !== 'element') {
        return
      }

      const attrs = componentConfig.thirdPartyComponents.get(componentTypeRef.name)
      if (attrs == null || !prop || prop.type !== 'ObjectExpression') {
        return
      }

      const propNames: string[] = []
      for (const p of prop.properties || []) {
        if (p.type !== 'Property') continue
        const propName = getPropName(p.key)
        if (propName && propName !== 'children' && propName !== 'id') {
          attrs.add(propName)
          propNames.push(propName)
        }
      }

      if (propNames.length > 0) {
        const prev = target.collectProps[componentTypeRef.name]
        const merged = prev ? Array.from(new Set([...prev.split('|'), ...propNames])) : propNames
        target.collectProps[componentTypeRef.name] = merged.join('|')
      }
    }
  }, createWalkBase(walk))

  return target
}

export function collectCreateElementTagsFromAst (
  ast: any,
  walk: any,
  onElement: (tag: string) => void
): void {
  walk.ancestor(ast, {
    CallExpression: (node: any) => {
      if (!isCreateElementCallee(node.callee)) return

      const type = node.arguments?.[0]
      if (type?.value) {
        onElement(type.value)
      }
    }
  }, createWalkBase(walk))
}

export function syncCachedComponentNames (
  elementNames: Iterable<string>,
  componentNames: Iterable<string>,
  componentConfig: IComponentConfig,
  onParseCreateElement?: Func
): void {
  for (const name of elementNames) {
    onParseCreateElement?.(name, componentConfig)
  }

  for (const name of componentNames) {
    if (name === 'CustomWrapper' && !componentConfig.thirdPartyComponents.get('custom-wrapper')) {
      componentConfig.thirdPartyComponents.set('custom-wrapper', new Set())
      return
    }
  }
}
