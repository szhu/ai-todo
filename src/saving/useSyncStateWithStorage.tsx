import gistId from "./gistId";

export default function useSyncStateWithStorage<S>(
  setState: React.Dispatch<React.SetStateAction<S>>,
  loadState: () => Promise<S>,
  saveState: (state: S) => Promise<void>,
) {
  async function loadAndSetState() {
    if (!gistId) return;

    const newState = await loadState();
    setState(newState);
  }

  async function setSyncedState(stateAction: (prevState: S) => S) {
    const newState = await new Promise<S>((resolve) => {
      setState((prevState) => {
        const newState = stateAction(prevState);
        resolve(newState);
        return newState;
      });
    });
    await saveState(newState);
  }

  return [loadAndSetState, setSyncedState] as const;
}
