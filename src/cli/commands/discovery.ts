import { Command } from '@cliffy/command';
import { DockerClient } from '../../docker/client.ts';
import { MultiInstanceDiscoveryServer } from '../../api/mod.ts';
import { printError, printSuccess } from '../utils.ts';

const serveCommand = new Command()
  .name('serve')
  .description('Start the discovery server')
  .option('--port <port:number>', 'Port to listen on', { default: 3100 })
  .option('--host <host:string>', 'Host to bind to', { default: '127.0.0.1' })
  .action(async (options) => {
    try {
      const docker = new DockerClient();

      if (!await docker.ping()) {
        printError('Docker is not available');
        Deno.exit(1);
      }

      const server = new MultiInstanceDiscoveryServer(docker, {
        port: options.port,
        host: options.host,
      });

      printSuccess(`Starting discovery server on ${options.host}:${options.port}`);
      await server.start();
    } catch (error) {
      printError(
        `Failed to start discovery server: ${error instanceof Error ? error.message : error}`,
      );
      Deno.exit(1);
    }
  });

export const discoveryCommand = new Command()
  .name('discovery')
  .description('Discovery server for managing multiple LocalNet instances')
  .action(function () {
    this.showHelp();
  })
  .command('serve', serveCommand);
