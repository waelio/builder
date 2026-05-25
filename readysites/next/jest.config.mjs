import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  dir: "./",
});

const jestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testEnvironment: "jsdom",
};

export default createJestConfig(jestConfig);
