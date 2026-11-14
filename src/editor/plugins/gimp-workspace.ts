'use client'
// GIMP Workspace Presets & Management
// Multiple workspace configurations for different workflows

export interface WorkspaceConfig {
  id: string
  name: string
  description: string
  icon: string
  panels: PanelLayout
  toolbox: ToolboxLayout
  toolOptions: ToolOptionsLayout
  shortcuts: Record<string, string>
  menus: MenuConfig
  theme: ThemeConfig
  docks: DockConfig[]
}

export interface PanelLayout {
  left: PanelGroup[]
  right: PanelGroup[]
  top: PanelGroup[]
  bottom: PanelGroup[]
  floating: FloatingPanel[]
}

export interface PanelGroup {
  id: string
  type: 'tabbed' | 'stacked' | 'accordion'
  panels: string[] // panel IDs
  activeTab: number
  collapsed: boolean
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
}

export interface FloatingPanel {
  id: string
  panelId: string
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
}

export interface ToolboxLayout {
  mode: 'rail' | 'grid'
  columns: number
  rows: number
  sections: ToolboxSection[]
  showToolOptions: boolean
  lockPosition: boolean
}

export interface ToolboxSection {
  id: string
  type: 'tools' | 'colors' | 'options' | 'custom'
  items: string[] // tool IDs or special IDs
  orientation: 'vertical' | 'horizontal'
  collapsible: boolean
  collapsed: boolean
}

export interface ToolOptionsLayout {
  position: 'below-toolbox' | 'docked-right' | 'floating' | 'below-canvas'
  autoShow: boolean
  compactMode: boolean
  showPreview: boolean
}

export interface MenuConfig {
  menubar: MenuBarConfig[]
  contextMenus: Record<string, ContextMenuConfig[]>
}

export interface MenuBarConfig {
  id: string
  label: string
  items: MenuItemConfig[]
  visible: boolean
}

export interface MenuItemConfig {
  id: string
  label: string
  shortcut?: string
  icon?: string
  action?: string
  submenu?: MenuItemConfig[]
  separator?: boolean
  enabled: boolean
  visible: boolean
}

export interface ContextMenuConfig {
  id: string
  label: string
  items: MenuItemConfig[]
}

export interface ThemeConfig {
  id: string
  name: string
  base: 'dark' | 'light'
  colors: ThemeColors
  fonts: ThemeFonts
  spacing: ThemeSpacing
  borderRadius: string
  shadows: ThemeShadows
}

export interface ThemeColors {
  background: string
  surface: string
  surfaceElevated: string
  border: string
  borderLight: string
  primary: string
  primaryHover: string
  primaryActive: string
  secondary: string
  secondaryHover: string
  accent: string
  text: string
  textSecondary: string
  textMuted: string
  textOnPrimary: string
  error: string
  warning: string
  success: string
  info: string
  selection: string
  focus: string
  hover: string
  active: string
  disabled: string
  scrollbar: string
  scrollbarThumb: string
  toolbar: string
  panel: string
  panelHeader: string
  dialog: string
  tooltip: string
  link: string
  linkHover: string
}

export interface ThemeFonts {
  sans: string
  mono: string
  ui: string
  heading: string
  baseSize: number
  scaleRatio: number
}

export interface ThemeSpacing {
  xs: string
  sm: string
  md: string
  lg: string
  xl: string
  xxl: string
}

export interface ThemeShadows {
  sm: string
  md: string
  lg: string
  xl: string
  inner: string
}

export interface DockConfig {
  id: string
  position: 'left' | 'right' | 'top' | 'bottom' | 'floating'
  panels: string[]
  width?: number
  height?: number
  collapsible: boolean
  collapsed: boolean
  autoHide: boolean
  resizeHandle: boolean
}

// ============================================
// Built-in Workspace Presets
// ============================================

export const WORKSPACE_PRESETS: Record<string, WorkspaceConfig> = {
  essentials: {
    id: 'essentials',
    name: 'Essentials',
    description: 'Balanced layout for general editing',
    icon: '⚡',
    panels: {
      left: [
        { id: 'tools', type: 'tabbed', panels: ['toolbox'], activeTab: 0, collapsed: false, width: 60 },
        { id: 'layers', type: 'tabbed', panels: ['layers', 'channels', 'paths'], activeTab: 0, collapsed: false, width: 280 },
      ],
      right: [
        { id: 'properties', type: 'tabbed', panels: ['properties', 'adjustments', 'history'], activeTab: 0, collapsed: false, width: 320 },
        { id: 'color', type: 'tabbed', panels: ['color', 'swatches', 'gradients'], activeTab: 0, collapsed: false, width: 320 },
      ],
      top: [
        { id: 'tool-options', type: 'tabbed', panels: ['tool-options'], activeTab: 0, collapsed: false },
      ],
      bottom: [
        { id: 'timeline', type: 'tabbed', panels: ['timeline', 'animation'], activeTab: 0, collapsed: true, height: 200 },
      ],
      floating: [],
    },
    toolbox: {
      mode: 'rail',
      columns: 1,
      rows: 1,
      sections: [
        { id: 'tools', type: 'tools', items: [], orientation: 'vertical', collapsible: false, collapsed: false },
      ],
      showToolOptions: true,
      lockPosition: false,
    },
    toolOptions: {
      position: 'below-toolbox',
      autoShow: true,
      compactMode: false,
      showPreview: true,
    },
    shortcuts: {},
    menus: {
      menubar: [
        { id: 'file', label: 'File', items: [
          { id: 'new', label: 'New', shortcut: 'Ctrl+N', action: 'file.new' },
          { id: 'open', label: 'Open', shortcut: 'Ctrl+O', action: 'file.open' },
          { id: 'save', label: 'Save', shortcut: 'Ctrl+S', action: 'file.save' },
          { id: 'export', label: 'Export', shortcut: 'Ctrl+E', action: 'file.export' },
          { separator: true },
          { id: 'preferences', label: 'Preferences', shortcut: 'Ctrl+K', action: 'preferences' },
        ], visible: true },
        { id: 'edit', label: 'Edit', items: [
          { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', action: 'edit.undo' },
          { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: 'edit.redo' },
          { separator: true },
          { id: 'cut', label: 'Cut', shortcut: 'Ctrl+X', action: 'edit.cut' },
          { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C', action: 'edit.copy' },
          { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', action: 'edit.paste' },
        ], visible: true },
        { id: 'image', label: 'Image', items: [
          { id: 'resize', label: 'Image Size', shortcut: 'Ctrl+Alt+I', action: 'image.resize' },
          { id: 'canvas', label: 'Canvas Size', shortcut: 'Ctrl+Alt+C', action: 'image.canvas' },
          { id: 'rotate', label: 'Rotate', action: 'image.rotate' },
        ], visible: true },
        { id: 'layer', label: 'Layer', items: [
          { id: 'new-layer', label: 'New Layer', shortcut: 'Ctrl+Shift+N', action: 'layer.new' },
          { id: 'duplicate', label: 'Duplicate Layer', shortcut: 'Ctrl+J', action: 'layer.duplicate' },
          { id: 'merge-down', label: 'Merge Down', shortcut: 'Ctrl+E', action: 'layer.merge-down' },
        ], visible: true },
        { id: 'select', label: 'Select', items: [
          { id: 'all', label: 'All', shortcut: 'Ctrl+A', action: 'select.all' },
          { id: 'deselect', label: 'Deselect', shortcut: 'Ctrl+D', action: 'select.deselect' },
          { id: 'inverse', label: 'Inverse', shortcut: 'Ctrl+Shift+I', action: 'select.inverse' },
        ], visible: true },
        { id: 'filter', label: 'Filter', items: [
          { id: 'gallery', label: 'Filter Gallery', shortcut: 'Ctrl+F', action: 'filter.gallery' },
          { id: 'last', label: 'Repeat Last Filter', shortcut: 'Ctrl+F', action: 'filter.last' },
        ], visible: true },
        { id: 'view', label: 'View', items: [
          { id: 'zoom-in', label: 'Zoom In', shortcut: 'Ctrl++', action: 'view.zoom-in' },
          { id: 'zoom-out', label: 'Zoom Out', shortcut: 'Ctrl+-', action: 'view.zoom-out' },
          { id: 'fit', label: 'Fit on Screen', shortcut: 'Ctrl+0', action: 'view.fit' },
          { id: '100%', label: '100%', shortcut: 'Ctrl+1', action: 'view.100' },
        ], visible: true },
        { id: 'window', label: 'Window', items: [
          { id: 'workspace', label: 'Workspace', action: 'window.workspace' },
          { id: 'arrange', label: 'Arrange', action: 'window.arrange' },
        ], visible: true },
        { id: 'help', label: 'Help', items: [
          { id: 'guide', label: 'User Guide', action: 'help.guide' },
          { id: 'shortcuts', label: 'Keyboard Shortcuts', action: 'help.shortcuts' },
        ], visible: true },
      ],
      contextMenus: {
        canvas: [
          { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', action: 'edit.undo' },
          { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: 'edit.redo' },
          { separator: true },
          { id: 'cut', label: 'Cut', shortcut: 'Ctrl+X', action: 'edit.cut' },
          { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C', action: 'edit.copy' },
          { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', action: 'edit.paste' },
          { separator: true },
          { id: 'select-all', label: 'Select All', shortcut: 'Ctrl+A', action: 'select.all' },
          { id: 'deselect', label: 'Deselect', shortcut: 'Ctrl+D', action: 'select.deselect' },
        ],
        layer: [
          { id: 'duplicate', label: 'Duplicate Layer', shortcut: 'Ctrl+J', action: 'layer.duplicate' },
          { id: 'delete', label: 'Delete Layer', action: 'layer.delete' },
          { separator: true },
          { id: 'merge-down', label: 'Merge Down', shortcut: 'Ctrl+E', action: 'layer.merge-down' },
          { id: 'merge-visible', label: 'Merge Visible', shortcut: 'Ctrl+Shift+E', action: 'layer.merge-visible' },
          { separator: true },
          { id: 'layer-style', label: 'Layer Style', action: 'layer.style' },
          { id: 'blending-options', label: 'Blending Options', action: 'layer.blending' },
        ],
      },
    },
    theme: {
      id: 'dark',
      name: 'Dark',
      base: 'dark',
      colors: {
        background: '#1a1a2e',
        surface: '#16213e',
        surfaceElevated: '#0f3460',
        border: '#2a2a4a',
        borderLight: '#3a3a5a',
        primary: '#e94560',
        primaryHover: '#ff6b7d',
        primaryActive: '#d63a50',
        secondary: '#0f3460',
        secondaryHover: '#1a4a8a',
        accent: '#e94560',
        text: '#eaeaea',
        textSecondary: '#b0b0b0',
        textMuted: '#808080',
        textOnPrimary: '#ffffff',
        error: '#ff4444',
        warning: '#ffaa00',
        success: '#00cc88',
        info: '#00aaff',
        selection: '#e94560',
        focus: '#e94560',
        hover: '#2a2a4a',
        active: '#0f3460',
        disabled: '#4a4a6a',
        scrollbar: '#1a1a2e',
        scrollbarThumb: '#3a3a5a',
        toolbar: '#16213e',
        panel: '#16213e',
        panelHeader: '#0f3460',
        dialog: '#16213e',
        tooltip: '#0f3460',
        link: '#e94560',
        linkHover: '#ff6b7d',
      },
      fonts: {
        sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        mono: 'JetBrains Mono, "Fira Code", Consolas, monospace',
        ui: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        heading: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        baseSize: 14,
        scaleRatio: 1.25,
      },
      spacing: {
        xs: '2px',
        sm: '4px',
        md: '8px',
        lg: '16px',
        xl: '24px',
        xxl: '32px',
      },
      borderRadius: '6px',
      shadows: {
        sm: '0 1px 2px rgba(0,0,0,0.3)',
        md: '0 4px 6px rgba(0,0,0,0.4)',
        lg: '0 10px 15px rgba(0,0,0,0.5)',
        xl: '0 20px 25px rgba(0,0,0,0.6)',
        inner: 'inset 0 2px 4px rgba(0,0,0,0.3)',
      },
    },
    docks: [
      { id: 'left', position: 'left', panels: ['toolbox', 'layers'], width: 60, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
      { id: 'right', position: 'right', panels: ['properties', 'color'], width: 320, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
      { id: 'top', position: 'top', panels: ['tool-options'], height: 48, collapsible: true, collapsed: false, autoHide: false, resizeHandle: false },
      { id: 'bottom', position: 'bottom', panels: ['timeline'], height: 200, collapsible: true, collapsed: true, autoHide: false, resizeHandle: true },
    ],
  },

  photography: {
    id: 'photography',
    name: 'Photography',
    description: 'Optimized for photo editing and retouching',
    icon: '📷',
    panels: {
      left: [
        { id: 'tools', type: 'tabbed', panels: ['toolbox'], activeTab: 0, collapsed: false, width: 60 },
        { id: 'layers', type: 'tabbed', panels: ['layers', 'channels', 'paths'], activeTab: 0, collapsed: false, width: 280 },
      ],
      right: [
        { id: 'adjustments', type: 'tabbed', panels: ['adjustments', 'properties'], activeTab: 0, collapsed: false, width: 320 },
        { id: 'color', type: 'tabbed', panels: ['color', 'swatches', 'histogram'], activeTab: 0, collapsed: false, width: 320 },
        { id: 'effects', type: 'tabbed', panels: ['effects', 'filters', 'lut'], activeTab: 0, collapsed: false, width: 320 },
      ],
      top: [
        { id: 'tool-options', type: 'tabbed', panels: ['tool-options'], activeTab: 0, collapsed: false },
        { id: 'camera-raw', type: 'tabbed', panels: ['camera-raw'], activeTab: 0, collapsed: true },
      ],
      bottom: [
        { id: 'history', type: 'tabbed', panels: ['history', 'snapshots'], activeTab: 0, collapsed: false, height: 150 },
        { id: 'export', type: 'tabbed', panels: ['export', 'batch'], activeTab: 0, collapsed: true, height: 200 },
      ],
      floating: [
        { id: 'color-picker', panelId: 'color-picker', x: 100, y: 100, width: 280, height: 400, minimized: false },
      ],
    },
    toolbox: {
      mode: 'rail',
      columns: 1,
      rows: 1,
      sections: [
        { id: 'select', type: 'tools', items: ['move', 'marquee-rect', 'marquee-ellipse', 'lasso', 'object-select', 'quick-select', 'magic-wand'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'crop', type: 'tools', items: ['crop', 'perspective-crop', 'slice', 'slice-select'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'measure', type: 'tools', items: ['eyedropper', 'color-sampler', 'measure', 'count'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'retouch', type: 'tools', items: ['spot-healing', 'healing-brush', 'patch', 'clone-stamp', 'remove'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'brush', type: 'tools', items: ['brush', 'pencil', 'mixer-brush', 'color-replacement'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'adjust', type: 'tools', items: ['dodge', 'burn', 'sponge', 'blur', 'sharpen', 'smudge'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'vector', type: 'tools', items: ['pen', 'text', 'shape', 'path-select', 'direct-select'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'nav', type: 'tools', items: ['hand', 'zoom', 'rotate-view'], orientation: 'vertical', collapsible: true, collapsed: false },
      ],
      showToolOptions: true,
      lockPosition: false,
    },
    toolOptions: {
      position: 'below-toolbox',
      autoShow: true,
      compactMode: false,
      showPreview: true,
    },
    shortcuts: {},
    menus: {
      menubar: [],
      contextMenus: {},
    },
    theme: {
      id: 'photography-dark',
      name: 'Photography Dark',
      base: 'dark',
      colors: {
        background: '#1e1e1e',
        surface: '#252526',
        surfaceElevated: '#2d2d2d',
        border: '#3c3c3c',
        borderLight: '#4a4a4a',
        primary: '#007acc',
        primaryHover: '#0099ff',
        primaryActive: '#005a9e',
        secondary: '#2d2d2d',
        secondaryHover: '#3c3c3c',
        accent: '#007acc',
        text: '#cccccc',
        textSecondary: '#969696',
        textMuted: '#6a6a6a',
        textOnPrimary: '#ffffff',
        error: '#f14c4c',
        warning: '#cca700',
        success: '#4ec9b0',
        info: '#3794ff',
        selection: '#264f78',
        focus: '#007acc',
        hover: '#2a2d2e',
        active: '#0e639c',
        disabled: '#3a3d41',
        scrollbar: '#1e1e1e',
        scrollbarThumb: '#424242',
        toolbar: '#252526',
        panel: '#252526',
        panelHeader: '#2d2d2d',
        dialog: '#2d2d2d',
        tooltip: '#2d2d2d',
        link: '#3794ff',
        linkHover: '#64b5f6',
      },
      fonts: {
        sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        mono: 'Consolas, "Courier New", monospace',
        ui: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        heading: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        baseSize: 13,
        scaleRatio: 1.25,
      },
      spacing: { xs: '2px', sm: '4px', md: '8px', lg: '16px', xl: '24px', xxl: '32px' },
      borderRadius: '4px',
      shadows: { sm: '0 1px 2px rgba(0,0,0,0.3)', md: '0 4px 6px rgba(0,0,0,0.4)', lg: '0 10px 15px rgba(0,0,0,0.5)', xl: '0 20px 25px rgba(0,0,0,0.6)', inner: 'inset 0 2px 4px rgba(0,0,0,0.3)' },
    },
    docks: [
      { id: 'left', position: 'left', panels: ['toolbox', 'layers'], width: 60, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
      { id: 'right', position: 'right', panels: ['adjustments', 'color', 'effects'], width: 320, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
      { id: 'top', position: 'top', panels: ['tool-options', 'camera-raw'], height: 48, collapsible: true, collapsed: false, autoHide: false, resizeHandle: false },
      { id: 'bottom', position: 'bottom', panels: ['history', 'export'], height: 200, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
    ],
  },

  painting: {
    id: 'painting',
    name: 'Digital Painting',
    description: 'Canvas-focused layout for digital painting and illustration',
    icon: '🎨',
    panels: {
      left: [
        { id: 'tools', type: 'tabbed', panels: ['toolbox'], activeTab: 0, collapsed: false, width: 60 },
        { id: 'brushes', type: 'tabbed', panels: ['brushes', 'brush-presets', 'brush-settings'], activeTab: 0, collapsed: false, width: 280 },
        { id: 'symmetry', type: 'tabbed', panels: ['symmetry', 'perspective'], activeTab: 0, collapsed: false, width: 280 },
      ],
      right: [
        { id: 'color', type: 'tabbed', panels: ['color', 'swatches', 'color-wheel', 'mixer'], activeTab: 0, collapsed: false, width: 320 },
        { id: 'layers', type: 'tabbed', panels: ['layers', 'groups'], activeTab: 0, collapsed: false, width: 280 },
        { id: 'references', type: 'tabbed', panels: ['references', 'navigator'], activeTab: 0, collapsed: false, width: 280 },
      ],
      top: [
        { id: 'tool-options', type: 'tabbed', panels: ['tool-options'], activeTab: 0, collapsed: false },
        { id: 'brush-preview', type: 'tabbed', panels: ['brush-preview'], activeTab: 0, collapsed: false },
      ],
      bottom: [
        { id: 'timeline', type: 'tabbed', panels: ['timeline', 'animation', 'onion-skin'], activeTab: 0, collapsed: false, height: 200 },
      ],
      floating: [
        { id: 'color-picker', panelId: 'color-picker', x: 100, y: 100, width: 280, height: 400, minimized: false },
        { id: 'brush-preview-float', panelId: 'brush-preview', x: 400, y: 100, width: 200, height: 200, minimized: false },
      ],
    },
    toolbox: {
      mode: 'rail',
      columns: 1,
      rows: 1,
      sections: [
        { id: 'brush', type: 'tools', items: ['brush', 'pencil', 'airbrush', 'ink', 'mypaint-brush', 'eraser'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'color', type: 'tools', items: ['eyedropper', 'color-sampler', 'fill', 'gradient'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'select', type: 'tools', items: ['move', 'marquee-rect', 'lasso', 'magic-wand'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'transform', type: 'tools', items: ['move', 'rotate', 'scale', 'perspective', 'warp'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'symmetry', type: 'tools', items: ['mirror', 'radial', 'mandala', 'tiling'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'nav', type: 'tools', items: ['hand', 'zoom', 'rotate-view'], orientation: 'vertical', collapsible: true, collapsed: false },
      ],
      showToolOptions: true,
      lockPosition: false,
    },
    toolOptions: {
      position: 'below-toolbox',
      autoShow: true,
      compactMode: false,
      showPreview: true,
    },
    shortcuts: {},
    menus: { menubar: [], contextMenus: {} },
    theme: {
      id: 'painting-dark',
      name: 'Painting Dark',
      base: 'dark',
      colors: {
        background: '#0d1117',
        surface: '#161b22',
        surfaceElevated: '#21262d',
        border: '#30363d',
        borderLight: '#484f58',
        primary: '#58a6ff',
        primaryHover: '#79c0ff',
        primaryActive: '#388bfd',
        secondary: '#21262d',
        secondaryHover: '#30363d',
        accent: '#a371f7',
        text: '#e6edf3',
        textSecondary: '#8b949e',
        textMuted: '#6e7681',
        textOnPrimary: '#ffffff',
        error: '#f85149',
        warning: '#d29922',
        success: '#3fb950',
        info: '#58a6ff',
        selection: '#1f4287',
        focus: '#58a6ff',
        hover: '#1f4287',
        active: '#1f4287',
        disabled: '#484f58',
        scrollbar: '#0d1117',
        scrollbarThumb: '#30363d',
        toolbar: '#161b22',
        panel: '#161b22',
        panelHeader: '#21262d',
        dialog: '#21262d',
        tooltip: '#21262d',
        link: '#58a6ff',
        linkHover: '#79c0ff',
      },
      fonts: {
        sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        mono: 'JetBrains Mono, "Fira Code", Consolas, monospace',
        ui: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        heading: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        baseSize: 14,
        scaleRatio: 1.25,
      },
      spacing: { xs: '2px', sm: '4px', md: '8px', lg: '16px', xl: '24px', xxl: '32px' },
      borderRadius: '6px',
      shadows: { sm: '0 1px 2px rgba(0,0,0,0.3)', md: '0 4px 6px rgba(0,0,0,0.4)', lg: '0 10px 15px rgba(0,0,0,0.5)', xl: '0 20px 25px rgba(0,0,0,0.6)', inner: 'inset 0 2px 4px rgba(0,0,0,0.3)' },
    },
    docks: [
      { id: 'left', position: 'left', panels: ['toolbox', 'brushes', 'symmetry'], width: 60, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
      { id: 'right', position: 'right', panels: ['color', 'layers', 'references'], width: 320, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
      { id: 'top', position: 'top', panels: ['tool-options', 'brush-preview'], height: 48, collapsible: true, collapsed: false, autoHide: false, resizeHandle: false },
      { id: 'bottom', position: 'bottom', panels: ['timeline'], height: 200, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
    ],
  },

  graphic_design: {
    id: 'graphic_design',
    name: 'Graphic Design',
    description: 'Layout, typography, and vector design workflow',
    icon: '🎨',
    panels: {
      left: [
        { id: 'tools', type: 'tabbed', panels: ['toolbox'], activeTab: 0, collapsed: false, width: 60 },
        { id: 'layers', type: 'tabbed', panels: ['layers', 'pages', 'assets'], activeTab: 0, collapsed: false, width: 280 },
      ],
      right: [
        { id: 'properties', type: 'tabbed', panels: ['properties', 'character', 'paragraph'], activeTab: 0, collapsed: false, width: 320 },
        { id: 'assets', type: 'tabbed', panels: ['assets', 'libraries', 'cc-libraries'], activeTab: 0, collapsed: false, width: 320 },
        { id: 'effects', type: 'tabbed', panels: ['effects', 'styles', 'graphic-styles'], activeTab: 0, collapsed: false, width: 320 },
      ],
      top: [
        { id: 'tool-options', type: 'tabbed', panels: ['tool-options'], activeTab: 0, collapsed: false },
        { id: 'controls', type: 'tabbed', panels: ['align', 'distribute', 'transform'], activeTab: 0, collapsed: false },
      ],
      bottom: [
        { id: 'pages', type: 'tabbed', panels: ['pages', 'artboards'], activeTab: 0, collapsed: false, height: 150 },
        { id: 'export', type: 'tabbed', panels: ['export', 'asset-export'], activeTab: 0, collapsed: true, height: 200 },
      ],
      floating: [],
    },
    toolbox: {
      mode: 'rail',
      columns: 1,
      rows: 1,
      sections: [
        { id: 'select', type: 'tools', items: ['move', 'direct-select', 'path-select'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'shape', type: 'tools', items: ['shape', 'pen', 'pen-freeform', 'pen-curvature'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'type', type: 'tools', items: ['text', 'type-mask-horizontal', 'type-mask-vertical'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'shape-tools', type: 'tools', items: ['rectangle', 'ellipse', 'polygon', 'line', 'custom-shape'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'select-tools', type: 'tools', items: ['marquee-rect', 'marquee-ellipse', 'lasso'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'paint', type: 'tools', items: ['brush', 'pencil', 'gradient', 'fill'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'slice', type: 'tools', items: ['slice', 'slice-select', 'hotspot'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'nav', type: 'tools', items: ['hand', 'zoom', 'rotate-view', 'artboard'], orientation: 'vertical', collapsible: true, collapsed: false },
      ],
      showToolOptions: true,
      lockPosition: false,
    },
    toolOptions: {
      position: 'below-toolbox',
      autoShow: true,
      compactMode: false,
      showPreview: true,
    },
    shortcuts: {},
    menus: { menubar: [], contextMenus: {} },
    theme: {
      id: 'design-light',
      name: 'Design Light',
      base: 'light',
      colors: {
        background: '#f5f5f5',
        surface: '#ffffff',
        surfaceElevated: '#fafafa',
        border: '#e0e0e0',
        borderLight: '#e8e8e8',
        primary: '#1976d2',
        primaryHover: '#1e88e5',
        primaryActive: '#1565c0',
        secondary: '#f5f5f5',
        secondaryHover: '#eeeeee',
        accent: '#1976d2',
        text: '#212121',
        textSecondary: '#757575',
        textMuted: '#9e9e9e',
        textOnPrimary: '#ffffff',
        error: '#d32f2f',
        warning: '#f57c00',
        success: '#388e3c',
        info: '#0288d1',
        selection: '#bbdefb',
        focus: '#1976d2',
        hover: '#e8e8e8',
        active: '#bbdefb',
        disabled: '#bdbdbd',
        scrollbar: '#f5f5f5',
        scrollbarThumb: '#bdbdbd',
        toolbar: '#ffffff',
        panel: '#ffffff',
        panelHeader: '#f5f5f5',
        dialog: '#ffffff',
        tooltip: '#ffffff',
        link: '#1976d2',
        linkHover: '#1e88e5',
      },
      fonts: {
        sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        mono: 'JetBrains Mono, "Fira Code", Consolas, monospace',
        ui: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        heading: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        baseSize: 14,
        scaleRatio: 1.25,
      },
      spacing: { xs: '2px', sm: '4px', md: '8px', lg: '16px', xl: '24px', xxl: '32px' },
      borderRadius: '4px',
      shadows: { sm: '0 1px 2px rgba(0,0,0,0.1)', md: '0 4px 6px rgba(0,0,0,0.1)', lg: '0 10px 15px rgba(0,0,0,0.1)', xl: '0 20px 25px rgba(0,0,0,0.1)', inner: 'inset 0 2px 4px rgba(0,0,0,0.1)' },
    },
    docks: [
      { id: 'left', position: 'left', panels: ['toolbox', 'layers'], width: 60, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
      { id: 'right', position: 'right', panels: ['properties', 'assets', 'effects'], width: 320, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
      { id: 'top', position: 'top', panels: ['tool-options', 'controls'], height: 48, collapsible: true, collapsed: false, autoHide: false, resizeHandle: false },
      { id: 'bottom', position: 'bottom', panels: ['pages', 'export'], height: 200, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
    ],
  },

  video: {
    id: 'video',
    name: 'Video Editing',
    description: 'Timeline-based video editing and compositing',
    icon: '🎬',
    panels: {
      left: [
        { id: 'project', type: 'tabbed', panels: ['project', 'media', 'effects'], activeTab: 0, collapsed: false, width: 320 },
        { id: 'tools', type: 'tabbed', panels: ['toolbox'], activeTab: 0, collapsed: false, width: 60 },
      ],
      right: [
        { id: 'inspector', type: 'tabbed', panels: ['inspector', 'effects', 'transitions'], activeTab: 0, collapsed: false, width: 320 },
        { id: 'color', type: 'tabbed', panels: ['color', 'scopes', 'lut'], activeTab: 0, collapsed: false, width: 320 },
        { id: 'audio', type: 'tabbed', panels: ['audio', 'audio-mixer'], activeTab: 0, collapsed: false, width: 320 },
      ],
      top: [
        { id: 'tool-options', type: 'tabbed', panels: ['tool-options'], activeTab: 0, collapsed: false },
        { id: 'preview', type: 'tabbed', panels: ['preview', 'program-monitor'], activeTab: 0, collapsed: false },
      ],
      bottom: [
        { id: 'timeline', type: 'tabbed', panels: ['timeline', 'tracks', 'keyframes'], activeTab: 0, collapsed: false, height: 300 },
      ],
      floating: [
        { id: 'source-monitor', panelId: 'source-monitor', x: 100, y: 100, width: 640, height: 360, minimized: false },
      ],
    },
    toolbox: {
      mode: 'rail',
      columns: 1,
      rows: 1,
      sections: [
        { id: 'select', type: 'tools', items: ['move', 'selection', 'razor', 'slip', 'slide'], orientation: 'vertical', collapsible: true, collapsed: false },
        { id: 'nav', type: 'tools', items: ['hand', 'zoom', 'scroll'], orientation: 'vertical', collapsible: true, collapsed: false },
      ],
      showToolOptions: true,
      lockPosition: false,
    },
    toolOptions: {
      position: 'below-toolbox',
      autoShow: true,
      compactMode: false,
      showPreview: true,
    },
    shortcuts: {},
    menus: { menubar: [], contextMenus: {} },
    theme: {
      id: 'video-dark',
      name: 'Video Dark',
      base: 'dark',
      colors: {
        background: '#141414',
        surface: '#1e1e1e',
        surfaceElevated: '#252525',
        border: '#333333',
        borderLight: '#404040',
        primary: '#d32f2f',
        primaryHover: '#ef5350',
        primaryActive: '#c62828',
        secondary: '#252525',
        secondaryHover: '#303030',
        accent: '#d32f2f',
        text: '#ffffff',
        textSecondary: '#b0b0b0',
        textMuted: '#808080',
        textOnPrimary: '#ffffff',
        error: '#ef5350',
        warning: '#ffa726',
        success: '#66bb6a',
        info: '#42a5f5',
        selection: '#3d3d3d',
        focus: '#d32f2f',
        hover: '#2a2a2a',
        active: '#333333',
        disabled: '#555555',
        scrollbar: '#141414',
        scrollbarThumb: '#333333',
        toolbar: '#1e1e1e',
        panel: '#1e1e1e',
        panelHeader: '#252525',
        dialog: '#252525',
        tooltip: '#252525',
        link: '#ef5350',
        linkHover: '#ff6b6b',
      },
      fonts: {
        sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        mono: 'JetBrains Mono, "Fira Code", Consolas, monospace',
        ui: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        heading: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        baseSize: 13,
        scaleRatio: 1.25,
      },
      spacing: { xs: '2px', sm: '4px', md: '8px', lg: '16px', xl: '24px', xxl: '32px' },
      borderRadius: '4px',
      shadows: { sm: '0 1px 2px rgba(0,0,0,0.3)', md: '0 4px 6px rgba(0,0,0,0.4)', lg: '0 10px 15px rgba(0,0,0,0.5)', xl: '0 20px 25px rgba(0,0,0,0.6)', inner: 'inset 0 2px 4px rgba(0,0,0,0.3)' },
    },
    docks: [
      { id: 'left', position: 'left', panels: ['project', 'toolbox'], width: 320, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
      { id: 'right', position: 'right', panels: ['inspector', 'color', 'audio'], width: 320, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
      { id: 'top', position: 'top', panels: ['tool-options', 'preview'], height: 48, collapsible: true, collapsed: false, autoHide: false, resizeHandle: false },
      { id: 'bottom', position: 'bottom', panels: ['timeline'], height: 300, collapsible: true, collapsed: false, autoHide: false, resizeHandle: true },
    ],
  },

  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: 'Distraction-free editing with minimal UI',
    icon: '🔍',
    panels: {
      left: [
        { id: 'tools', type: 'tabbed', panels: ['toolbox'], activeTab: 0, collapsed: false, width: 60 },
      ],
      right: [
        { id: 'essential', type: 'tabbed', panels: ['layers', 'properties', 'color'], activeTab: 0, collapsed: false, width: 280 },
      ],
      top: [
        { id: 'toolbar', type: 'tabbed', panels: ['toolbar-minimal'], activeTab: 0, collapsed: false },
      ],
      bottom: [],
      floating: [],
    },
    toolbox: {
      mode: 'rail',
      columns: 1,
      rows: 1,
      sections: [
        { id: 'tools', type: 'tools', items: ['move', 'brush', 'eraser', 'zoom', 'hand'], orientation: 'vertical', collapsible: false, collapsed: false },
      ],
      showToolOptions: false,
      lockPosition: true,
    },
    toolOptions: {
      position: 'floating',
      autoShow: false,
      compactMode: true,
      showPreview: false,
    },
    shortcuts: {},
    menus: { menubar: [], contextMenus: {} },
    theme: {
      id: 'minimal-dark',
      name: 'Minimal Dark',
      base: 'dark',
      colors: {
        background: '#0d0d0d',
        surface: '#121212',
        surfaceElevated: '#1a1a1a',
        border: '#2a2a2a',
        borderLight: '#333333',
        primary: '#ffffff',
        primaryHover: '#e0e0e0',
        primaryActive: '#cccccc',
        secondary: '#1a1a1a',
        secondaryHover: '#222222',
        accent: '#ffffff',
        text: '#ffffff',
        textSecondary: '#aaaaaa',
        textMuted: '#666666',
        textOnPrimary: '#000000',
        error: '#ff4444',
        warning: '#ffaa00',
        success: '#00cc88',
        info: '#00aaff',
        selection: '#ffffff',
        focus: '#ffffff',
        hover: '#1a1a1a',
        active: '#1a1a1a',
        disabled: '#444444',
        scrollbar: '#0d0d0d',
        scrollbarThumb: '#333333',
        toolbar: '#121212',
        panel: '#121212',
        panelHeader: '#1a1a1a',
        dialog: '#1a1a1a',
        tooltip: '#1a1a1a',
        link: '#ffffff',
        linkHover: '#e0e0e0',
      },
      fonts: {
        sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        mono: 'JetBrains Mono, "Fira Code", Consolas, monospace',
        ui: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        heading: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        baseSize: 14,
        scaleRatio: 1.25,
      },
      spacing: { xs: '2px', sm: '4px', md: '8px', lg: '16px', xl: '24px', xxl: '32px' },
      borderRadius: '4px',
      shadows: { sm: '0 1px 2px rgba(0,0,0,0.3)', md: '0 4px 6px rgba(0,0,0,0.4)', lg: '0 10px 15px rgba(0,0,0,0.5)', xl: '0 20px 25px rgba(0,0,0,0.6)', inner: 'inset 0 2px 4px rgba(0,0,0,0.3)' },
    },
    docks: [
      { id: 'left', position: 'left', panels: ['toolbox'], width: 60, collapsible: false, collapsed: false, autoHide: true, resizeHandle: false },
      { id: 'right', position: 'right', panels: ['essential'], width: 280, collapsible: true, collapsed: false, autoHide: true, resizeHandle: false },
      { id: 'top', position: 'top', panels: ['toolbar'], height: 40, collapsible: false, collapsed: false, autoHide: false, resizeHandle: false },
    ],
  },
}

// Workspace Manager
export class WorkspaceManager {
  private workspaces: Map<string, WorkspaceConfig> = new Map()
  private currentWorkspace: string = 'essentials'
  private listeners: Set<() => void> = new Set()

  constructor() {
    for (const [id, config] of Object.entries(WORKSPACE_PRESETS)) {
      this.workspaces.set(id, config)
    }
  }

  getCurrentWorkspace(): WorkspaceConfig {
    return this.workspaces.get(this.currentWorkspace)!
  }

  getCurrentWorkspaceId(): string {
    return this.currentWorkspace
  }

  setWorkspace(id: string): boolean {
    if (!this.workspaces.has(id)) return false
    this.currentWorkspace = id
    this.notify()
    return true
  }

  getWorkspace(id: string): WorkspaceConfig | undefined {
    return this.workspaces.get(id)
  }

  getAllWorkspaces(): WorkspaceConfig[] {
    return Array.from(this.workspaces.values())
  }

  createWorkspace(config: WorkspaceConfig): void {
    if (this.workspaces.has(config.id)) throw new Error('Workspace ID already exists')
    this.workspaces.set(config.id, config)
    this.notify()
  }

  updateWorkspace(id: string, updates: Partial<WorkspaceConfig>): boolean {
    const workspace = this.workspaces.get(id)
    if (!workspace) return false
    Object.assign(workspace, updates)
    this.notify()
    return true
  }

  deleteWorkspace(id: string): boolean {
    if (id === 'essentials') return false
    if (this.currentWorkspace === id) this.currentWorkspace = 'essentials'
    const result = this.workspaces.delete(id)
    if (result) this.notify()
    return result
  }

  duplicateWorkspace(id: string, newName: string): WorkspaceConfig | null {
    const workspace = this.workspaces.get(id)
    if (!workspace) return null

    const newWorkspace: WorkspaceConfig = {
      ...workspace,
      id: 'workspace-' + Date.now(),
      name: newName,
    }
    this.workspaces.set(newWorkspace.id, newWorkspace)
    this.notify()
    return newWorkspace
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Theme Manager */
export class ThemeManager {
  private themes: Map<string, ThemeConfig> = new Map()
  private currentTheme: string = 'dark'
  private listeners: Set<() => void> = new Set()

  constructor() {
    // Add built-in themes
    for (const workspace of Object.values(WORKSPACE_PRESETS)) {
      this.themes.set(workspace.theme.id, workspace.theme)
    }
    // Add additional themes
    this.themes.set('light', this.createLightTheme())
    this.themes.set('high-contrast', this.createHighContrastTheme())
  }

  getCurrentTheme(): ThemeConfig {
    return this.themes.get(this.currentTheme)!
  }

  setTheme(id: string): boolean {
    if (!this.themes.has(id)) return false
    this.currentTheme = id
    this.applyTheme()
    this.notify()
    return true
  }

  getTheme(id: string): ThemeConfig | undefined {
    return this.themes.get(id)
  }

  getAllThemes(): ThemeConfig[] {
    return Array.from(this.themes.values())
  }

  addTheme(theme: ThemeConfig): void {
    if (this.themes.has(theme.id)) throw new Error('Theme ID already exists')
    this.themes.set(theme.id, theme)
    this.notify()
  }

  removeTheme(id: string): boolean {
    if (id === this.currentTheme) return false
    const result = this.themes.delete(id)
    if (result) this.notify()
    return result
  }

  private applyTheme(): void {
    const theme = this.getCurrentTheme()
    const root = document.documentElement

    // Apply CSS custom properties
    for (const [key, value] of Object.entries(theme.colors)) {
      root.style.setProperty(`--color-${key}`, value)
    }
    root.style.setProperty('--font-sans', theme.fonts.sans)
    root.style.setProperty('--font-mono', theme.fonts.mono)
    root.style.setProperty('--font-ui', theme.fonts.ui)
    root.style.setProperty('--font-base-size', `${theme.fonts.baseSize}px`)
    root.style.setProperty('--spacing-xs', theme.spacing.xs)
    root.style.setProperty('--spacing-sm', theme.spacing.sm)
    root.style.setProperty('--spacing-md', theme.spacing.md)
    root.style.setProperty('--spacing-lg', theme.spacing.lg)
    root.style.setProperty('--spacing-xl', theme.spacing.xl)
    root.style.setProperty('--spacing-xxl', theme.spacing.xxl)
    root.style.setProperty('--border-radius', theme.borderRadius)
    root.style.setProperty('--shadow-sm', theme.shadows.sm)
    root.style.setProperty('--shadow-md', theme.shadows.md)
    root.style.setProperty('--shadow-lg', theme.shadows.lg)
    root.style.setProperty('--shadow-xl', theme.shadows.xl)
    root.style.setProperty('--shadow-inner', theme.shadows.inner)

    // Set data attribute for CSS
    document.body.dataset.theme = theme.id
  }

  private createLightTheme(): ThemeConfig {
    const darkTheme = this.themes.get('dark')!
    return {
      ...darkTheme,
      id: 'light',
      name: 'Light',
      base: 'light',
      colors: {
        ...darkTheme.colors,
        background: '#fafafa',
        surface: '#ffffff',
        surfaceElevated: '#f5f5f5',
        border: '#e0e0e0',
        borderLight: '#e8e8e8',
        primary: '#1976d2',
        primaryHover: '#1e88e5',
        primaryActive: '#1565c0',
        secondary: '#f5f5f5',
        secondaryHover: '#eeeeee',
        text: '#212121',
        textSecondary: '#757575',
        textMuted: '#9e9e9e',
        textOnPrimary: '#ffffff',
        error: '#d32f2f',
        warning: '#f57c00',
        success: '#388e3c',
        info: '#0288d1',
        selection: '#bbdefb',
        focus: '#1976d2',
        hover: '#e8e8e8',
        active: '#bbdefb',
        disabled: '#bdbdbd',
        scrollbar: '#f5f5f5',
        scrollbarThumb: '#bdbdbd',
        toolbar: '#ffffff',
        panel: '#ffffff',
        panelHeader: '#f5f5f5',
        dialog: '#ffffff',
        tooltip: '#ffffff',
        link: '#1976d2',
        linkHover: '#1e88e5',
      },
    }
  }

  private createHighContrastTheme(): ThemeConfig {
    return {
      id: 'high-contrast',
      name: 'High Contrast',
      base: 'dark',
      colors: {
        background: '#000000',
        surface: '#000000',
        surfaceElevated: '#1a1a1a',
        border: '#ffffff',
        borderLight: '#cccccc',
        primary: '#ffff00',
        primaryHover: '#ffff66',
        primaryActive: '#cccc00',
        secondary: '#1a1a1a',
        secondaryHover: '#333333',
        accent: '#00ffff',
        text: '#ffffff',
        textSecondary: '#cccccc',
        textMuted: '#888888',
        textOnPrimary: '#000000',
        error: '#ff0000',
        warning: '#ffff00',
        success: '#00ff00',
        info: '#00ffff',
        selection: '#ffff00',
        focus: '#ffff00',
        hover: '#333333',
        active: '#ffff00',
        disabled: '#555555',
        scrollbar: '#000000',
        scrollbarThumb: '#ffffff',
        toolbar: '#000000',
        panel: '#000000',
        panelHeader: '#1a1a1a',
        dialog: '#000000',
        tooltip: '#000000',
        link: '#ffff00',
        linkHover: '#ffff66',
      },
      fonts: {
        sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        mono: 'JetBrains Mono, "Fira Code", Consolas, monospace',
        ui: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        heading: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        baseSize: 14,
        scaleRatio: 1.25,
      },
      spacing: { xs: '2px', sm: '4px', md: '8px', lg: '16px', xl: '24px', xxl: '32px' },
      borderRadius: '4px',
      shadows: { sm: '0 1px 2px rgba(255,255,255,0.3)', md: '0 4px 6px rgba(255,255,255,0.4)', lg: '0 10px 15px rgba(255,255,255,0.5)', xl: '0 20px 25px rgba(255,255,255,0.6)', inner: 'inset 0 2px 4px rgba(255,255,255,0.3)' },
    }
  }

  getCurrentTheme(): ThemeConfig {
    return this.themes.get(this.currentTheme)!
  }

  setTheme(id: string): boolean {
    if (!this.themes.has(id)) return false
    this.currentTheme = id
    this.applyTheme()
    this.notify()
    return true
  }

  getTheme(id: string): ThemeConfig | undefined {
    return this.themes.get(id)
  }

  getAllThemes(): ThemeConfig[] {
    return Array.from(this.themes.values())
  }

  addTheme(theme: ThemeConfig): void {
    if (this.themes.has(theme.id)) throw new Error('Theme ID already exists')
    this.themes.set(theme.id, theme)
    this.notify()
  }

  removeTheme(id: string): boolean {
    if (id === this.currentTheme) return false
    const result = this.themes.delete(id)
    if (result) this.notify()
    return result
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Shortcut Manager for workspace-specific shortcuts */
export class WorkspaceShortcutManager {
  private shortcuts: Map<string, Record<string, string>> = new Map()
  private listeners: Set<() => void> = new Set()

  constructor() {
    this.loadDefaultShortcuts()
  }

  private loadDefaultShortcuts(): void {
    // Default shortcuts
    this.shortcuts.set('default', {
      'ctrl+n': 'file.new',
      'ctrl+o': 'file.open',
      'ctrl+s': 'file.save',
      'ctrl+shift+s': 'file.save-as',
      'ctrl+e': 'file.export',
      'ctrl+z': 'edit.undo',
      'ctrl+shift+z': 'edit.redo',
      'ctrl+x': 'edit.cut',
      'ctrl+c': 'edit.copy',
      'ctrl+v': 'edit.paste',
      'ctrl+a': 'select.all',
      'ctrl+d': 'select.deselect',
      'ctrl+shift+i': 'select.inverse',
      'ctrl+f': 'filter.gallery',
      'ctrl++': 'view.zoom-in',
      'ctrl+-': 'view.zoom-out',
      'ctrl+0': 'view.fit',
      'ctrl+1': 'view.100',
      'ctrl+shift+n': 'layer.new',
      'ctrl+j': 'layer.duplicate',
      'ctrl+e': 'layer.merge-down',
      'ctrl+shift+e': 'layer.merge-visible',
      'v': 'tool.move',
      'm': 'tool.marquee-rect',
      'l': 'tool.lasso',
      'w': 'tool.magic-wand',
      'b': 'tool.brush',
      'e': 'tool.eraser',
      't': 'tool.text',
      'p': 'tool.pen',
      'h': 'tool.hand',
      'z': 'tool.zoom',
      'ctrl+alt+i': 'image.resize',
      'ctrl+alt+c': 'image.canvas',
      'ctrl+k': 'preferences',
      'f1': 'help.guide',
      'f5': 'view.refresh',
    })

    // Photography workspace shortcuts
    this.shortcuts.set('photography', {
      ...this.shortcuts.get('default')!,
      'r': 'tool.crop',
      'shift+r': 'tool.rotate',
      'shift+t': 'tool.transform',
      'q': 'tool.quick-mask',
      'x': 'colors.swap',
      'd': 'colors.reset',
      'ctrl+l': 'adjustment.levels',
      'ctrl+m': 'adjustment.curves',
      'ctrl+u': 'adjustment.hue-saturation',
      'ctrl+b': 'adjustment.color-balance',
      'ctrl+shift+u': 'adjustment.desaturate',
      'ctrl+i': 'adjustment.invert',
      'ctrl+shift+n': 'layer.new',
      'ctrl+shift+alt+n': 'layer.new-group',
      'ctrl+g': 'layer.group',
      'ctrl+shift+g': 'layer.ungroup',
      'ctrl+shift+]': 'layer.bring-forward',
      'ctrl+[': 'layer.send-backward',
      'ctrl+shift+]': 'layer.bring-to-front',
      'ctrl+shift+[': 'layer.send-to-back',
    })

    // Painting workspace shortcuts
    this.shortcuts.set('painting', {
      ...this.shortcuts.get('default')!,
      'b': 'tool.brush',
      'shift+b': 'tool.pencil',
      'e': 'tool.eraser',
      'shift+e': 'tool.background-eraser',
      'g': 'tool.fill',
      'shift+g': 'tool.gradient',
      'o': 'tool.color-sampler',
      'i': 'tool.eyedropper',
      'shift+i': 'tool.color-sampler',
      '[': 'brush.size-decrease',
      ']': 'brush.size-increase',
      'shift+[': 'brush.hardness-decrease',
      'shift+]': 'brush.hardness-increase',
      ',': 'brush.rotate-decrease',
      '.': 'brush.rotate-increase',
      '<': 'brush.angle-decrease',
      '>': 'brush.angle-increase',
      'ctrl+shift+b': 'brush.mixer-brush',
      'ctrl+shift+a': 'brush.airbrush',
      'y': 'tool.history-brush',
      'shift+y': 'tool.art-history-brush',
      'f': 'tool.symmetry',
      'r': 'tool.rotate-view',
    })

    // Video workspace shortcuts
    this.shortcuts.set('video', {
      ...this.shortcuts.get('default')!,
      'space': 'timeline.play-pause',
      'j': 'timeline.rewind',
      'k': 'timeline.pause',
      'l': 'timeline.forward',
      'left': 'timeline.previous-frame',
      'right': 'timeline.next-frame',
      'up': 'timeline.previous-second',
      'down': 'timeline.next-second',
      'shift+left': 'timeline.previous-marker',
      'shift+right': 'timeline.next-marker',
      'home': 'timeline.go-to-start',
      'end': 'timeline.go-to-end',
      'i': 'timeline.set-in-point',
      'o': 'timeline.set-out-point',
      'ctrl+x': 'timeline.razor-cut',
      'ctrl+v': 'timeline.paste',
      'ctrl+b': 'timeline.blade',
      'v': 'tool.selection',
      'a': 'tool.track-select',
      'y': 'tool.slip',
      'u': 'tool.slide',
      'p': 'tool.pen',
      't': 'tool.text',
      'r': 'tool.rate-stretch',
      'ctrl+r': 'timeline.render',
      'ctrl+m': 'timeline.export',
    })
  }

  getShortcuts(workspaceId: string): Record<string, string> {
    return this.shortcuts.get(workspaceId) || this.shortcuts.get('default') || {}
  }

  setShortcuts(workspaceId: string, shortcuts: Record<string, string>): void {
    this.shortcuts.set(workspaceId, shortcuts)
    this.notify()
  }

  getShortcut(workspaceId: string, key: string): string | undefined {
    const shortcuts = this.getShortcuts(workspaceId)
    return shortcuts[key.toLowerCase()]
  }

  setShortcut(workspaceId: string, key: string, action: string): void {
    const shortcuts = this.getShortcuts(workspaceId)
    shortcuts[key.toLowerCase()] = action
    this.shortcuts.set(workspaceId, shortcuts)
    this.notify()
  }

  removeShortcut(workspaceId: string, key: string): boolean {
    const shortcuts = this.getShortcuts(workspaceId)
    const result = delete shortcuts[key.toLowerCase()]
    if (result) this.notify()
    return result
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}