import type { LocalNetConfig } from '../types/config.ts';
import { normalizeValidators } from '../types/config.ts';
import {
  DEFAULT_BASE_PORT,
  getSvInternalPorts,
  getSvPorts,
  getValidatorPorts,
} from '../utils/ports.ts';

export function generateNginxConfigString(config: LocalNetConfig): string {
  const validators = normalizeValidators(config.validators);
  const basePort = config.basePort ?? DEFAULT_BASE_PORT;
  const svPorts = getSvPorts(basePort);
  const svInternalPorts = getSvInternalPorts(basePort);
  const svWebUiPort = svPorts.webUi;

  const validatorServerBlocks = validators.map((v, i) => {
    const vPorts = getValidatorPorts(i, basePort);
    const port = vPorts.webUi;
    return `
    server {
        listen ${port};
        server_name wallet.localhost;

        location /api/validator {
            rewrite ^/(.*) /\$1 break;
            proxy_pass http://splice:${vPorts.validatorAdminApi}/api/validator;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }

        location / {
            proxy_pass http://wallet-web-ui-${v.name}:8080/;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }
    }`;
  }).join('\n');

  return `
events {
    worker_connections 1024;
}

http {
    server {
        listen ${svWebUiPort};
        server_name sv.localhost;

        location /api/sv {
            rewrite ^/(.*) /\$1 break;
            proxy_pass http://splice:${svInternalPorts.svAdmin}/api/sv;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }

        location / {
            proxy_pass http://sv-web-ui:8080/;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }
    }

    server {
        listen ${svWebUiPort};
        server_name scan.localhost;

        location /api/scan {
            rewrite ^/(.*) /\$1 break;
            proxy_pass http://splice:${svInternalPorts.scanAdmin}/api/scan;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }

        location /registry {
            rewrite ^/(.*) /\$1 break;
            proxy_pass http://splice:${svInternalPorts.scanAdmin}/registry;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }

        location / {
            proxy_pass http://scan-web-ui:8080/;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }
    }

    server {
        listen ${svWebUiPort};
        server_name wallet.localhost;

        location /api/validator {
            rewrite ^/(.*) /\$1 break;
            proxy_pass http://splice:${svPorts.validatorAdminApi}/api/validator;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }

        location / {
            proxy_pass http://wallet-web-ui-sv:8080/;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }
    }
${validatorServerBlocks}
}
`;
}
