/**
 * SVG icon system.
 *
 * Returns raw SVG markup strings for inline rendering.
 * Avoids external icon-font dependencies while keeping icons
 * crisp and styleable with CSS currentColor.
 */

export const icons = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,

  explore: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,

  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,

  library: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,

  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,

  link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.1.5l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1-.5l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/></svg>`,

  playlist: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,

  album: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`,

  artist: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,

  history: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,

  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,

  play: `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,

  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,

  skipForward: `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"/></svg>`,

  skipBack: `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2"/></svg>`,

  shuffle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`,

  repeat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,

  repeatOne: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M11 10.5l1-1v4.5"/></svg>`,

  volumeHigh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,

  volumeLow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,

  volumeMute: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,

  queue: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,

  lyrics: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,

  fullscreen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,

  minimize: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,

  maximize: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="1"/></svg>`,

  restore: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="4" width="12" height="12" rx="1"/><path d="M4 8v11a1 1 0 0 0 1 1h11"/></svg>`,

  grip: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`,

  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,

  chevronLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,

  chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,

  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,

  music: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  sonoraLogo: `<svg viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M256.9,311.6 L247.1,302.7 L233.8,297.4 L230.2,297.4 L229.3,296.5 L205.3,296.5 L204.4,297.4 L199.1,297.4 L198.2,298.2 L195.5,298.2 L194.6,299.1 L192.0,299.1 L191.1,300.0 L188.4,300.0 L187.5,300.9 L184.9,300.9 L184.0,301.8 L176.8,303.6 L174.2,305.4 L168.0,307.1 L146.6,317.8 L142.2,321.4 L139.5,322.3 L131.5,328.5 L127.9,330.3 L123.5,334.7 L117.3,339.2 L106.6,349.8 L95.9,364.1 L89.7,376.5 L89.7,378.3 L87.9,381.8 L87.9,384.5 L87.0,385.4 L87.0,389.0 L86.1,389.9 L86.1,404.1 L87.0,405.0 L87.0,407.6 L87.9,408.5 L88.8,413.0 L91.5,418.3 L101.2,429.0 L109.3,434.3 L112.8,435.2 L115.5,437.0 L117.3,437.0 L120.8,438.8 L123.5,438.8 L124.4,439.7 L128.8,439.7 L129.7,440.5 L148.4,440.5 L149.3,439.7 L154.6,439.7 L155.5,438.8 L163.5,437.9 L164.4,437.0 L167.1,437.0 L168.0,436.1 L180.4,432.5 L202.6,421.9 L207.1,418.3 L209.8,417.4 L224.0,405.9 L224.9,405.9 L238.2,392.5 L252.4,373.0 L258.7,360.5 L258.7,358.7 L261.3,352.5 L261.3,349.8 L262.2,348.9 L262.2,345.4 L263.1,344.5 L264.0,332.9 L263.1,332.0 L262.2,323.1 L261.3,322.3 L260.4,317.8 Z" fill="currentColor" /><path d="M251.6,51.0 L251.6,226.2 L252.4,227.1 L252.4,234.2 L253.3,235.1 L253.3,238.7 L254.2,239.5 L254.2,242.2 L255.1,243.1 L256.0,247.6 L258.7,252.0 L258.7,253.8 L260.4,255.6 L264.0,262.7 L269.3,269.8 L277.3,277.8 L278.2,277.8 L289.8,287.6 L300.5,294.7 L303.1,295.6 L307.6,299.1 L312.0,300.9 L313.8,302.7 L316.5,303.6 L318.3,305.4 L320.9,306.2 L322.7,308.0 L325.4,308.9 L340.5,318.7 L347.6,324.9 L348.5,324.9 L357.4,333.8 L363.6,342.7 L369.0,356.1 L369.0,361.4 L369.8,362.3 L369.8,373.0 L369.0,373.8 L369.0,378.3 L368.1,379.2 L368.1,382.7 L367.2,383.6 L366.3,388.1 L360.9,398.7 L354.7,407.6 L341.4,421.0 L324.5,432.5 L304.0,442.3 L299.6,443.2 L296.9,445.0 L295.1,445.0 L283.6,449.4 L280.9,449.4 L280.0,450.3 L277.3,450.3 L272.9,452.1 L269.3,452.1 L268.5,453.0 L261.3,453.9 L260.4,454.8 L256.0,454.8 L255.1,455.7 L243.5,456.6 L242.7,457.4 L222.2,458.3 L221.3,459.2 L208.0,459.2 L251.6,461.0 L252.4,460.1 L267.6,460.1 L268.5,459.2 L284.5,458.3 L285.3,457.4 L296.9,456.6 L297.8,455.7 L301.4,455.7 L302.2,454.8 L305.8,454.8 L310.3,453.0 L317.4,452.1 L318.3,451.2 L323.6,450.3 L329.8,447.7 L332.5,447.7 L335.2,445.9 L342.3,444.1 L344.9,442.3 L351.2,440.5 L355.6,437.9 L357.4,437.9 L374.3,429.0 L387.6,420.1 L406.3,402.3 L413.4,392.5 L418.8,382.7 L418.8,381.0 L420.5,378.3 L420.5,376.5 L422.3,373.8 L422.3,371.2 L424.1,367.6 L425.0,356.9 L425.9,356.1 L425.9,343.6 L425.0,342.7 L425.0,336.5 L424.1,335.6 L424.1,332.0 L423.2,331.2 L420.5,321.4 L411.6,305.4 L401.0,292.9 L400.1,292.9 L393.9,286.7 L378.7,276.0 L376.1,275.1 L374.3,273.3 L369.8,271.6 L368.1,269.8 L336.9,254.7 L335.2,254.7 L320.0,246.7 L318.3,246.7 L314.7,244.0 L312.9,244.0 L311.1,242.2 L297.8,235.1 L287.1,227.1 L276.5,215.5 L270.2,204.0 L269.3,198.6 L268.5,197.7 L268.5,193.3 L267.6,192.4 L267.6,134.6 L268.5,133.7 L277.3,141.7 L285.3,147.1 L303.1,155.9 L304.9,155.9 L312.0,159.5 L313.8,159.5 L314.7,160.4 L316.5,160.4 L317.4,161.3 L319.1,161.3 L320.0,162.2 L321.8,162.2 L322.7,163.1 L324.5,163.1 L325.4,164.0 L327.1,164.0 L328.0,164.8 L359.2,174.6 L361.8,176.4 L363.6,176.4 L369.8,180.0 L371.6,180.0 L380.5,184.4 L382.3,186.2 L385.0,187.1 L393.0,192.4 L397.4,196.9 L398.3,196.9 L409.0,208.4 L416.1,220.9 L416.1,222.6 L418.8,228.9 L418.8,231.5 L419.6,232.4 L419.6,236.0 L420.5,236.9 L420.5,248.4 L421.4,244.0 L422.3,243.1 L422.3,240.4 L423.2,239.5 L423.2,236.9 L424.1,236.0 L424.1,231.5 L425.0,230.7 L425.0,224.4 L425.9,223.5 L425.9,210.2 L425.0,209.3 L424.1,196.9 L421.4,189.7 L421.4,187.1 L412.5,167.5 L402.7,153.3 L385.0,136.4 L381.4,134.6 L373.4,128.4 L360.9,122.1 L359.2,120.4 L352.1,116.8 L350.3,116.8 L340.5,111.5 L338.7,111.5 L332.5,107.9 L330.7,107.9 L320.9,102.6 L319.1,102.6 L288.9,86.6 L277.3,78.6 L267.6,69.7 L266.7,69.7 L256.0,58.1 Z" fill="currentColor" /></svg>`,
} as const;

export type IconName = keyof typeof icons;

/** Render an icon SVG string by name. */
export function icon(name: IconName): string {
  return icons[name];
}
