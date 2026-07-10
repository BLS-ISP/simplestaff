const path = require("path");

module.exports = {
  publicPath: "./",
  transpileDependencies: ["axios"],
  configureWebpack: {
    optimization: {
      splitChunks: {
        minSize: 10000,
        maxSize: 250000,
      },
    },
  },
  chainWebpack: (config) => {
    config.module
      .rule("images")
      .use("url-loader")
      .loader("url-loader")
      .tap((options) => {
        options.limit = -1;
        return options;
      });
  },
  css: {
    loaderOptions: {
      sass: {
        sassOptions: {
          includePaths: [
            path.resolve(__dirname, "node_modules"),
            path.resolve(
              __dirname,
              "node_modules/carbon-components/scss/globals/scss/vendor"
            ),
          ],
          silenceDeprecations: [
            "import",
            "global-builtin",
            "color-functions",
            "if-function",
            "legacy-js-api",
          ],
        },
      },
    },
  },
};
