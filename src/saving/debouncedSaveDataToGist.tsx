import debounce from "../util/timeout/debounce";
import saveDataFromGist from "./saveDataToGist";

export default debounce(saveDataFromGist, 1000);
