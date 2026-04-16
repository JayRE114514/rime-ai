import { readFileSync } from 'fs';
import yaml from 'js-yaml';

const configPath = new URL('./config.yaml', import.meta.url);
let config = yaml.load(readFileSync(configPath, 'utf8'));

export function reloadConfig() {
  config = yaml.load(readFileSync(configPath, 'utf8'));
  return config;
}

export default config;
