import type { NextConfig } from "next";
import webpack from "webpack";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@orca-so/whirlpools-core/dist/nodejs":
        "@orca-so/whirlpools-core/dist/browser",
      "@orca-so/whirlpools-core": "@orca-so/whirlpools-core/dist/browser",
    };

    config.experiments = {
      asyncWebAssembly: true,
      layers: true,
    };

    config.resolve.fallback = {
      ...config.resolve.fallback,
      buffer: require.resolve("buffer"),
      process: require.resolve("process/browser"),
      // Kamino SDK's signer.js does `require('fs')` for a Node-only
      // parseKeypairFile helper we never call. Stub it for the browser bundle.
      fs: false,
      path: false,
      os: false,
    };

    config.plugins.push(
      new webpack.ProvidePlugin({
        Buffer: ["buffer", "Buffer"],
        process: ["process"],
      }),
    );

    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /node_modules\/.*\/ox\//,
        message:
          /Critical dependency: the request of a dependency is an expression/,
      },
    ];

    return config;
  },

  transpilePackages: ["@orca-so/whirlpools-core"],
};

export default nextConfig;
