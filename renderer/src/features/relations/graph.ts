import type { ElementDefinition } from 'cytoscape'
import type {
  CharacterCard,
  CharacterRelationship,
  OrganizationEntry,
  OrganizationMembership
} from '@/types/app'

export type RelationsGraphNodeKind = 'character' | 'organization'
export type RelationsGraphEdgeKind = 'relationship' | 'membership'
export type RelationsGraphFocusMode = 'overview' | 'chain' | 'camp'

export type RelationsGraphNode = {
  id: string
  entityId: string
  kind: RelationsGraphNodeKind
  label: string
  subtitle: string
  description: string
  accent: string
  searchText: string
}

export type RelationsGraphEdge = {
  id: string
  kind: RelationsGraphEdgeKind
  source: string
  target: string
  label: string
  description: string
  intensity: number
  searchText: string
}

export type RelationsGraphData = {
  nodes: RelationsGraphNode[]
  edges: RelationsGraphEdge[]
}

export type RelationsGraphFilterState = {
  query: string
  highIntensityOnly: boolean
}

export type FilteredRelationsGraph = {
  nodes: RelationsGraphNode[]
  edges: RelationsGraphEdge[]
  matchedNodeIds: Set<string>
}

export type RelationsGraphFocusState = {
  focusedNodeIds: Set<string>
  focusedEdgeIds: Set<string>
  memberNodeIds: Set<string>
  internalRelationshipEdgeIds: Set<string>
}

export type RelationsGraphHotspot = RelationsGraphNode & {
  degree: number
}

const HIGH_INTENSITY_THRESHOLD = 65
const ACCENT_PALETTE = ['#2563eb', '#f97316', '#0f766e', '#c026d3', '#ca8a04', '#7c3aed']

export function buildRelationsGraphData(payload: {
  characters: CharacterCard[]
  organizations: OrganizationEntry[]
  characterRelationships: CharacterRelationship[]
  organizationMemberships: OrganizationMembership[]
}): RelationsGraphData {
  const nodes = [
    ...payload.organizations.map<RelationsGraphNode>((organization) => ({
      id: buildOrganizationNodeId(organization.id),
      entityId: organization.id,
      kind: 'organization',
      label: organization.name,
      subtitle: organization.type || '组织',
      description: organization.description,
      accent: resolveAccentColor(organization.color, organization.name),
      searchText: `${organization.name} ${organization.type} ${organization.description} ${organization.motto}`.toLowerCase()
    })),
    ...payload.characters.map<RelationsGraphNode>((character) => ({
      id: buildCharacterNodeId(character.id),
      entityId: character.id,
      kind: 'character',
      label: character.name,
      subtitle: character.role || '角色',
      description: character.description,
      accent: resolveAccentColor(character.avatar, character.name),
      searchText: `${character.name} ${character.role} ${character.description} ${(character.tags ?? []).map((tag) => tag.label).join(' ')}`.toLowerCase()
    }))
  ]

  const nodeIdSet = new Set(nodes.map((node) => node.id))
  const characterNameMap = new Map(payload.characters.map((character) => [character.id, character.name]))
  const organizationNameMap = new Map(payload.organizations.map((organization) => [organization.id, organization.name]))

  const relationshipEdges = payload.characterRelationships
    .map<RelationsGraphEdge | null>((relationship) => {
      const source = buildCharacterNodeId(relationship.fromCharacterId)
      const target = buildCharacterNodeId(relationship.toCharacterId)
      if (!nodeIdSet.has(source) || !nodeIdSet.has(target)) {
        return null
      }

      return {
        id: `relationship-${relationship.id}`,
        kind: 'relationship',
        source,
        target,
        label: relationship.type || '角色关系',
        description: relationship.description,
        intensity: normalizeIntensity(relationship.intensity),
        searchText: `${characterNameMap.get(relationship.fromCharacterId) ?? ''} ${characterNameMap.get(relationship.toCharacterId) ?? ''} ${relationship.type} ${relationship.description}`.toLowerCase()
      }
    })
    .filter((edge): edge is RelationsGraphEdge => Boolean(edge))

  const membershipEdges = payload.organizationMemberships
    .map<RelationsGraphEdge | null>((membership) => {
      const source = buildCharacterNodeId(membership.characterId)
      const target = buildOrganizationNodeId(membership.organizationId)
      if (!nodeIdSet.has(source) || !nodeIdSet.has(target)) {
        return null
      }

      return {
        id: `membership-${membership.id}`,
        kind: 'membership',
        source,
        target,
        label: membership.role || '成员归属',
        description: membership.notes,
        intensity: 100,
        searchText: `${characterNameMap.get(membership.characterId) ?? ''} ${organizationNameMap.get(membership.organizationId) ?? ''} ${membership.role} ${membership.notes}`.toLowerCase()
      }
    })
    .filter((edge): edge is RelationsGraphEdge => Boolean(edge))

  return {
    nodes,
    edges: [...relationshipEdges, ...membershipEdges]
  }
}

export function filterRelationsGraph(
  graph: RelationsGraphData,
  filters: RelationsGraphFilterState
): FilteredRelationsGraph {
  const normalizedQuery = filters.query.trim().toLowerCase()
  const baseNodes = graph.nodes.filter((node) => node.kind === 'character')
  const baseNodeMap = new Map(baseNodes.map((node) => [node.id, node]))
  const directNodeMatches = new Set(
    baseNodes
      .filter((node) => !normalizedQuery || node.searchText.includes(normalizedQuery))
      .map((node) => node.id)
  )

  const baseEdges = graph.edges.filter((edge) => {
    if (edge.kind !== 'relationship') {
      return false
    }

    if (filters.highIntensityOnly && edge.intensity < HIGH_INTENSITY_THRESHOLD) {
      return false
    }

    return baseNodeMap.has(edge.source) && baseNodeMap.has(edge.target)
  })

  if (!normalizedQuery) {
    return {
      nodes: baseNodes,
      edges: baseEdges,
      matchedNodeIds: new Set<string>()
    }
  }

  const visibleNodeIds = new Set<string>(directNodeMatches)
  const matchedEdgeIds = new Set<string>()

  for (const edge of baseEdges) {
    const sourceMatched = directNodeMatches.has(edge.source)
    const targetMatched = directNodeMatches.has(edge.target)
    const edgeMatched = edge.searchText.includes(normalizedQuery)

    if (edgeMatched || sourceMatched || targetMatched) {
      matchedEdgeIds.add(edge.id)
      visibleNodeIds.add(edge.source)
      visibleNodeIds.add(edge.target)
    }
  }

  return {
    nodes: baseNodes.filter((node) => visibleNodeIds.has(node.id)),
    edges: baseEdges.filter(
      (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target) && matchedEdgeIds.has(edge.id)
    ),
    matchedNodeIds: directNodeMatches
  }
}

export function buildRelationsGraphFocusState(
  graph: RelationsGraphData,
  selectedNodeId: string | null,
  mode: RelationsGraphFocusMode
): RelationsGraphFocusState {
  const focusedNodeIds = new Set<string>()
  const focusedEdgeIds = new Set<string>()
  const memberNodeIds = new Set<string>()
  const internalRelationshipEdgeIds = new Set<string>()

  if (!selectedNodeId) {
    return { focusedNodeIds, focusedEdgeIds, memberNodeIds, internalRelationshipEdgeIds }
  }

  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId)
  if (!selectedNode) {
    return { focusedNodeIds, focusedEdgeIds, memberNodeIds, internalRelationshipEdgeIds }
  }

  focusedNodeIds.add(selectedNodeId)

  const selectedEdges = graph.edges.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)

  if (mode === 'overview') {
    for (const edge of selectedEdges) {
      focusedEdgeIds.add(edge.id)
      focusedNodeIds.add(edge.source)
      focusedNodeIds.add(edge.target)
    }

    return { focusedNodeIds, focusedEdgeIds, memberNodeIds, internalRelationshipEdgeIds }
  }

  if (mode === 'chain') {
    for (const edge of selectedEdges) {
      focusedNodeIds.add(edge.source)
      focusedNodeIds.add(edge.target)
    }

    for (const edge of graph.edges) {
      if (focusedNodeIds.has(edge.source) && focusedNodeIds.has(edge.target)) {
        focusedEdgeIds.add(edge.id)
      }
    }

    return { focusedNodeIds, focusedEdgeIds, memberNodeIds, internalRelationshipEdgeIds }
  }

  if (selectedNode.kind === 'organization') {
    for (const edge of graph.edges) {
      if (edge.kind === 'membership' && edge.target === selectedNodeId) {
        focusedNodeIds.add(edge.source)
        memberNodeIds.add(edge.source)
      }
    }

    for (const edge of graph.edges) {
      if (edge.kind === 'relationship' && memberNodeIds.has(edge.source) && memberNodeIds.has(edge.target)) {
        focusedEdgeIds.add(edge.id)
        internalRelationshipEdgeIds.add(edge.id)
        focusedNodeIds.add(edge.source)
        focusedNodeIds.add(edge.target)
      }
    }

    return { focusedNodeIds, focusedEdgeIds, memberNodeIds, internalRelationshipEdgeIds }
  }

  for (const edge of selectedEdges) {
    focusedEdgeIds.add(edge.id)
    focusedNodeIds.add(edge.source)
    focusedNodeIds.add(edge.target)
  }

  return { focusedNodeIds, focusedEdgeIds, memberNodeIds, internalRelationshipEdgeIds }
}

export function buildRelationsGraphHotspots(graph: RelationsGraphData): RelationsGraphHotspot[] {
  const degreeMap = buildDegreeMap(graph)

  return [...graph.nodes]
    .map((node) => ({
      ...node,
      degree: degreeMap.get(node.id) ?? 0
    }))
    .sort((left, right) => right.degree - left.degree)
    .slice(0, 5)
}

export function buildOrganizationMemberIds(graph: RelationsGraphData, organizationEntityId: string | null): Set<string> {
  if (!organizationEntityId) {
    return new Set<string>()
  }

  const organizationNodeId = buildOrganizationNodeId(organizationEntityId)
  return new Set(
    graph.edges
      .filter((edge) => edge.kind === 'membership' && edge.target === organizationNodeId)
      .map((edge) => edge.source)
  )
}

export function buildCharacterOrganizationLabels(graph: RelationsGraphData, characterNodeId: string): string[] {
  const organizationNodeMap = new Map(
    graph.nodes.filter((node) => node.kind === 'organization').map((node) => [node.id, node.label])
  )

  return graph.edges
    .filter((edge) => edge.kind === 'membership' && edge.source === characterNodeId)
    .map((edge) => organizationNodeMap.get(edge.target))
    .filter((label): label is string => Boolean(label))
}

export function buildRelationsCytoscapeElements(graph: FilteredRelationsGraph): ElementDefinition[] {
  const degreeMap = buildDegreeMap(graph)

  return [
    ...graph.nodes.map<ElementDefinition>((node) => ({
      data: {
        id: node.id,
        entityId: node.entityId,
        kind: node.kind,
        label: node.label,
        subtitle: node.subtitle,
        description: node.description,
        accent: node.accent,
        searchText: node.searchText,
        avatarLabel: resolveAvatarLabel(node.label),
        accentTextColor: resolveReadableTextColor(node.accent),
        degree: degreeMap.get(node.id) ?? 0,
        size: resolveNodeSize(degreeMap.get(node.id) ?? 0),
        glowSize: resolveNodeGlowSize(degreeMap.get(node.id) ?? 0),
        borderColor: resolveBorderColor(node.accent)
      },
      classes: [node.kind, graph.matchedNodeIds.has(node.id) ? 'matched' : ''].filter(Boolean).join(' ')
    })),
    ...graph.edges.map<ElementDefinition>((edge) => ({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        label: edge.label,
        description: edge.description,
        intensity: edge.intensity,
        searchText: edge.searchText,
        width: resolveEdgeWidth(edge),
        opacity: edge.kind === 'membership' ? 0.78 : 0.24 + edge.intensity / 170,
        color: resolveRelationshipEdgeColor(edge.intensity),
        activeColor: resolveRelationshipActiveColor(edge.intensity)
      },
      classes: edge.kind
    }))
  ]
}

export function buildCharacterNodeId(characterId: string): string {
  return `character-${characterId}`
}

export function buildOrganizationNodeId(organizationId: string): string {
  return `organization-${organizationId}`
}

export function resolveAccentColor(source: string, fallbackSeed: string): string {
  const hexMatch = source.match(/#(?:[0-9a-fA-F]{3}){1,2}/)
  if (hexMatch) {
    return hexMatch[0]
  }

  const rgbMatch = source.match(/rgba?\(([^)]+)\)/)
  if (rgbMatch) {
    return `rgb(${rgbMatch[1].split(',').slice(0, 3).join(',')})`
  }

  return ACCENT_PALETTE[Math.abs(hashString(fallbackSeed)) % ACCENT_PALETTE.length]
}

function normalizeIntensity(intensity: number): number {
  if (!Number.isFinite(intensity)) {
    return 50
  }
  return Math.max(0, Math.min(100, Math.round(intensity)))
}

function resolveEdgeWidth(edge: RelationsGraphEdge): number {
  if (edge.kind === 'membership') {
    return 3
  }

  return 1.8 + edge.intensity / 24
}

function resolveNodeSize(degree: number): number {
  return Math.min(82, 58 + degree * 4.5)
}

function resolveNodeGlowSize(degree: number): number {
  return Math.min(26, 14 + degree * 2)
}

function resolveRelationshipEdgeColor(intensity: number): string {
  if (intensity >= 85) {
    return '#2563eb'
  }
  if (intensity >= 70) {
    return '#3b82f6'
  }
  if (intensity >= 55) {
    return '#60a5fa'
  }
  return '#93c5fd'
}

function resolveRelationshipActiveColor(intensity: number): string {
  if (intensity >= 85) {
    return '#1d4ed8'
  }
  if (intensity >= 70) {
    return '#2563eb'
  }
  if (intensity >= 55) {
    return '#3b82f6'
  }
  return '#60a5fa'
}

function resolveBorderColor(accent: string): string {
  return accent
}

export function resolveAvatarLabel(label: string): string {
  const normalized = label.trim()
  return Array.from(normalized)[0] ?? '?'
}

export function resolveReadableTextColor(accent: string): string {
  const rgb = parseColorToRgb(accent)
  if (!rgb) {
    return '#ffffff'
  }

  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
  return luminance > 0.68 ? '#0f172a' : '#ffffff'
}

function parseColorToRgb(color: string): [number, number, number] | null {
  const hex = color.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  if (hex) {
    const value = hex[1]
    if (value.length === 3) {
      return [
        Number.parseInt(`${value[0]}${value[0]}`, 16),
        Number.parseInt(`${value[1]}${value[1]}`, 16),
        Number.parseInt(`${value[2]}${value[2]}`, 16)
      ]
    }

    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16)
    ]
  }

  const rgb = color.match(/^rgb\(([^)]+)\)$/)
  if (!rgb) {
    return null
  }

  const [red, green, blue] = rgb[1].split(',').slice(0, 3).map((item) => Number.parseInt(item.trim(), 10))
  if ([red, green, blue].some((value) => Number.isNaN(value))) {
    return null
  }

  return [red, green, blue]
}

function buildDegreeMap(graph: Pick<RelationsGraphData, 'nodes' | 'edges'>): Map<string, number> {
  const degreeMap = new Map<string, number>()
  for (const node of graph.nodes) {
    degreeMap.set(node.id, 0)
  }

  for (const edge of graph.edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1)
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1)
  }

  return degreeMap
}

function hashString(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return hash
}
