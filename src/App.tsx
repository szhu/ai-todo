import { css } from "@emotion/css";
import { useEffect, useState } from "react";
import Data, {
  Group,
  Item,
  createId,
  getGroups,
  getItem,
  getItemsInGroup,
  upsertGroup,
  upsertItem,
} from "./data/Data";
import debouncedSaveDataToGist from "./saving/debouncedSaveDataToGist";
import loadDataFromGist from "./saving/loadDataFromGist";
import useSyncStateWithStorage from "./saving/useSyncStateWithStorage";
import SingleLineTextInput from "./visual/SingleLineTextInput";

export function App() {
  const [data, setData] = useState<Data | undefined>(undefined);
  const [loadData, setAndSaveData] = useSyncStateWithStorage<Data>(
    setData as React.Dispatch<React.SetStateAction<Data>>,
    loadDataFromGist,
    debouncedSaveDataToGist,
  );

  useEffect(() => {
    loadData();
  }, []);

  if (data == null) return null;

  return (
    <>
      <h1
        className={css`
          color: blue;
        `}
      >
        Todo App
      </h1>
      <div>
        {getGroups(data).map((group) => (
          <fieldset key={group.id}>
            <legend>
              <SingleLineTextInput
                value={group.title}
                onChange={(e) => updateGroupTitle(group, e.currentTarget.value)}
              />
            </legend>
            <div
              className={css`
                display: flex;
                flex-direction: column;
                gap: 4rem;
              `}
            >
              {getItemsInGroup(data, group.id).map((item) => (
                <div
                  key={item.id}
                  className={css`
                    display: flex;
                  `}
                >
                  <input
                    type="checkbox"
                    checked={item.completedAt != null}
                    onInput={(e) => e.preventDefault()}
                    onChange={toggleItemCompleted(item)}
                  />
                  <SingleLineTextInput
                    className={css`
                      width: 100%;
                    `}
                    value={item.title}
                    onChange={(e) => renameItem(item, e.currentTarget.value)}
                  />
                </div>
              ))}
              <button onClick={() => addItem(group)}>Add item</button>
            </div>
          </fieldset>
        ))}
      </div>
      <button onClick={() => addGroup()}>Add group</button>
    </>
  );

  async function updateGroupTitle(group: Group, title: string) {
    return await setAndSaveData((currentData) =>
      upsertGroup(currentData, {
        ...group,
        title,
      }),
    );
  }

  async function addGroup() {
    const title = prompt("New group title");
    if (title) {
      await setAndSaveData((currentData) =>
        upsertGroup(currentData, { id: createId(), title, itemIds: [] }),
      );
    }
  }

  async function addItem(group: Group) {
    const title = prompt("New item title");
    if (!title) return;

    await setAndSaveData((currentData) =>
      upsertItem(
        currentData,
        { id: createId(), title, completedAt: undefined },
        group.id,
      ),
    );
  }

  async function renameItem(item: Item, title: string) {
    await setAndSaveData((currentData) => {
      const currentItem = getItem(currentData, item.id);
      return upsertItem(currentData, {
        ...currentItem,
        title,
      });
    });
  }

  function toggleItemCompleted(item: Item) {
    return () =>
      setAndSaveData((currentData) => {
        const currentItem = getItem(currentData, item.id);
        return upsertItem(currentData, {
          ...currentItem,
          completedAt: item.completedAt ? undefined : new Date(),
        });
      });
  }
}
