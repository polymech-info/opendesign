import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconDir = [
  path.resolve(__dirname, "dist/tabler-icons"),
  path.resolve(__dirname, "../../packages/tabler-icons/icons/filled"),
].find((dir) => fs.existsSync(dir));
const uiPort = Number(process.env.OPEND_UI_PORT || 5174);
const apiPort = Number(process.env.OPEND_PORT || 3727);

/** Single all-in-one client bundle for `pm-opendesign` + local `npm run dev`.
 *  `rspack build --env preset=web` is the browser build: OPFS instead of the API server.
 */
export default (env = {}, argv = {}) => {
  const isDev = argv.mode !== "production";
  const web = env.preset === "web";

  return {
    target: "web",
    entry: path.resolve(__dirname, "src/client/main.tsx"),
    output: {
      path: path.resolve(__dirname, web ? "dist/client-web" : "dist/client"),
      publicPath: web ? "./" : "/",
      filename: "opend.bundle.js",
      chunkFilename: "opend.[name].js",
      assetModuleFilename: "opend.[name][ext]",
      clean: !web,
    },
    resolve: {
      extensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
      ...(web ? { extensionAlias: { ".js": [".ts", ".tsx", ".js"] } } : {}),
      alias: {
        react: "preact/compat",
        "react-dom": "preact/compat",
        "react/jsx-runtime": "preact/jsx-runtime",
        "react/jsx-dev-runtime": "preact/jsx-runtime",
        "react-dom/test-utils": "preact/test-utils",
      },
      fallback: {
        fs: false,
        path: false,
        canvas: false,
      },
    },
    module: {
      parser: {
        javascript: {
          // TanStack Router looks up React.use; Preact compat does not export it.
          exportsPresence: false,
          importExportsPresence: false,
        },
      },
      rules: [
        {
          test: /\.[jt]sx?$/,
          include: [
            path.resolve(__dirname, "src/client"),
            path.resolve(__dirname, "src/shared"),
            path.resolve(__dirname, "src/design"),
            path.resolve(__dirname, "src/server/seed-templates.ts"),
          ],
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: { syntax: "typescript", tsx: true },
              transform: {
                react: {
                  runtime: "automatic",
                  importSource: "preact",
                  development: isDev,
                },
              },
              target: "es2022",
            },
          },
        },
        {
          test: /\.css$/,
          use: ["style-loader", "css-loader", "postcss-loader"],
        },
      ],
    },
    plugins: [
      new rspack.HtmlRspackPlugin({
        template: path.resolve(__dirname, "src/client/index.html"),
        filename: "index.html",
        inject: "body",
        title: "OpenDesign",
        minify: !isDev,
      }),
      new rspack.DefinePlugin({
        "import.meta.env.PRESET": JSON.stringify(web ? "web" : "app"),
      }),
      ...(web && iconDir
        ? [new rspack.CopyRspackPlugin({ patterns: [{ from: iconDir, to: "tabler-icons" }] })]
        : []),
      ...(web
        ? [
            new rspack.NormalModuleReplacementPlugin(
              /[/\\]client[/\\]api(\.ts)?$/,
              path.resolve(__dirname, "src/client/api.web.ts"),
            ),
            new rspack.NormalModuleReplacementPlugin(
              /[/\\]client[/\\]mode(\.ts)?$/,
              path.resolve(__dirname, "src/client/mode.web.ts"),
            ),
          ]
        : []),
    ],
    devtool: isDev ? "eval-source-map" : false,
    stats: "errors-warnings",
    infrastructureLogging: { level: "error" },
    performance: { hints: false },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
    },
    devServer: isDev && !web
      ? {
          host: "127.0.0.1",
          port: uiPort,
          hot: true,
          historyApiFallback: true,
          allowedHosts: "all",
          proxy: [
            {
              context: ["/api", "/tabler-icons", "/llms.txt"],
              target: `http://127.0.0.1:${apiPort}`,
            },
          ],
        }
      : undefined,
  };
};
