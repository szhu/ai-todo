import debounce from "../util/timeout/debounce";
import saveDataFromGist from "./saveDataToGist";

// The Gist update API call can be called at most 100 times per 10 minutes. This
// means it can be called on average once every 6 seconds without hitting the
// rate limit.
export default debounce(saveDataFromGist, 6000);
