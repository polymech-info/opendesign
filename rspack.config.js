import path from "node:path";
import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiPort = Number(process.env.OPEND_PORT || 3727);
const uiPort = Number(process.env.OPEND_UI_PORT || 5174);

/** Single all-in-one client bundle for `pm-opendesign` + local `npm run dev`. */
export default (env = {}, argv = {}) => {
  const isDev = argv.mode !== "production";

  return {
    target: "web",
    entry: path.resolve(__dirname, "src/client/main.tsx"),
    output: {
      path: path.resolve(__dirname, "dist/client"),
      publicPath: "/",
      filename: "opend.bundle.js",
      chunkFilename: "opend.[name].js",
      assetModuleFilename: "opend.[name][ext]",
      clean: true,
    },
    resolve: {
      extensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
      alias: {
        react: "preact/compat",
        "react-dom": "preact/compat",
        "react/jsx-runtime": "preact/jsx-runtime",
        "react-dom/test-utils": "preact/test-utils",
      },
      fallback: {
        fs: false,
        path: false,
        canvas: false,
      },
    },
    module: {
      rules: [
        {
          test: /\.[jt]sx?$/,
          include: [
            path.resolve(__dirname, "src/client"),
            path.resolve(__dirname, "src/shared"),
            path.resolve(__dirname, "src/design"),
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
    ],
    devtool: isDev ? "eval-source-map" : false,
    stats: "errors-warnings",
    infrastructureLogging: { level: "error" },
    performance: { hints: false },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
    },
    devServer: isDev
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
