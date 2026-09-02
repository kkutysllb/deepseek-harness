# OpenKylin

English | [中文](README.zh.md)

OpenKylin (`openkylin`) is an open-source agent harness. It is a fork of [DeepSeek Harness](https://github.com/kkutysllb/deepseek-harness), originally developed by DeepSeek AI, aligned upstream at `dsh-v0.1.2-alpha.3` and rebranded for the OpenKylin product line.

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

OpenKylin is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @qilin/cli web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/kkutysllb/OpenKylin.git
cd OpenKylin
pnpm install
pnpm run build
pnpm openkylin web
```

`pnpm run build` prepares the repository artifacts. `pnpm openkylin web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/kkutysllb/OpenKylin/discussions).
- Add the [`qilin-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Upstream project and community: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
