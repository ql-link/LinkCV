// 写入层（JS）对外暴露的数据结构。
export interface SiteConfig {
  kind?: 'beisen' | 'moka' | 'atsx' | 'site';
  domain?: string;
  group_class?: string;
  level1_class?: string;
  level2_class?: string;
  option_container_selector?: string;
  option_selector?: string;
  delay_fill_selector?: string;
  selectElements?: string;
}

export type FillStatus = 'filled' | 'typed' | 'failed' | 'skipped';
