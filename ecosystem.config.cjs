module.exports = {
  apps: [
    {
      name: "gringos-video-editor",
      script: "scripts/pm2-next-dev.cjs",
      cwd: "C:\\Users\\Mauro\\gringos-video-editor",
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
