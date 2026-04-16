import { readFileSync } from 'fs';
import yaml from 'js-yaml';

const configPath = new URL('./config.yaml', import.meta.url);

const state = {
  config: yaml.load(readFileSync(configPath, 'utf8')),
};

export function reloadConfig() {
  state.config = yaml.load(readFileSync(configPath, 'utf8'));
  return state.config;
}

export default state;
