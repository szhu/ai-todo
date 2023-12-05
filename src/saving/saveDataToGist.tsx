import Data from "../data/Data";
import { updateGistFile } from "../github/api";
import gistId from "./gistId";

export default async function saveDataToGist(
  data: Data | undefined,
): Promise<void> {
  if (!gistId) return;

  await updateGistFile(
    localStorage.GITHUB_ACCESS_TOKEN,
    gistId,
    "data.json",
    JSON.stringify(data, null, 2),
  );
}
