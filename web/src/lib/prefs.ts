const THINKING_KEY = 'atem_thinking_panel'
const WEB_SEARCH_KEY = 'atem_web_search'

export const getThinkingEnabled = (): boolean =>
  localStorage.getItem(THINKING_KEY) !== 'false'

export const setThinkingEnabled = (val: boolean): void =>
  localStorage.setItem(THINKING_KEY, String(val))

export const getWebSearchEnabled = (): boolean =>
  localStorage.getItem(WEB_SEARCH_KEY) !== 'false'

export const setWebSearchEnabled = (val: boolean): void =>
  localStorage.setItem(WEB_SEARCH_KEY, String(val))
