// Registra o hook de resolução de ./ts-extension-loader.mjs para o
// processo de teste atual. Usado via `node --import`. API nativa do Node
// (`node:module`), nenhuma dependência nova.
import { register } from 'node:module';

register('./ts-extension-loader.mjs', import.meta.url);
