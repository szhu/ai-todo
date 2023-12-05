import { getGistFile } from "../api/github";
import { BlankData } from "../data/Data";
import gistId from "./gistId";

export default async function loadDataFromGist() {
  if (!gistId) return BlankData;

  const contents = await getGistFile(
    localStorage.GITHUB_ACCESS_TOKEN &&
      JSON.parse(localStorage.GITHUB_ACCESS_TOKEN),
    gistId,
    "data.json",
  );

  if (contents) {
    return JSON.parse(contents);
  } else {
    return BlankData;
  }
}
