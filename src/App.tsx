import { css } from "@emotion/css";
import { useEffect, useRef, useState } from "react";
import Data, {
  Group,
  Id,
  Item,
  createId,
  deleteGroup,
  deleteItem,
  getGroup,
  getGroupAt,
  getGroups,
  getItem,
  getItemAt,
  getItemsInGroup,
  upsertGroup,
  upsertItem,
} from "./data/Data";
import debouncedSaveDataToGist from "./saving/debouncedSaveDataToGist";
import loadDataFromGist from "./saving/loadDataFromGist";
import useSyncStateWithStorage from "./saving/useSyncStateWithStorage";
import SingleLineTextInput from "./visual/SingleLineTextInput";

interface CursorLocation {
  type: "group" | "item";
  id: Id;
  field: "title";
  selection: number | undefined | "all";
}

function cursorLocationMatches(
  loc: CursorLocation | undefined,
  type: CursorLocation["type"],
  id: CursorLocation["id"],
  field: CursorLocation["field"],
): loc is CursorLocation {
  return Boolean(
    loc && loc.type === type && loc.id === id && loc.field === field,
  );
}

export function App() {
  const [data, setData] = useState<Data | undefined>(undefined);
  const [loadData, setAndSaveData] = useSyncStateWithStorage<Data>(
    setData as React.Dispatch<React.SetStateAction<Data>>,
    loadDataFromGist,
    debouncedSaveDataToGist,
  );

  const nextCursorLocationRef = useRef<CursorLocation | undefined>(undefined);
  function setCursor(
    type: CursorLocation["type"],
    id: CursorLocation["id"],
    field: CursorLocation["field"],
    selection: CursorLocation["selection"],
  ) {
    nextCursorLocationRef.current = {
      type,
      id,
      field,
      selection,
    };
  }

  function applyCursorLocation(
    el: HTMLInputElement | HTMLTextAreaElement | undefined | null,
    type: CursorLocation["type"],
    id: CursorLocation["id"],
    field: CursorLocation["field"],
  ) {
    if (!el) return;

    const loc = nextCursorLocationRef.current;
    if (cursorLocationMatches(loc, type, id, field)) {
      el.focus();
      if (loc.selection === "all") {
        el.select();
      } else {
        const position = loc.selection ?? el.value.length;
        el.setSelectionRange(position, position);
      }
      nextCursorLocationRef.current = undefined;
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  if (data == null) return null;

  return (
    <div
      className={css`
        padding: 20rem;
      `}
    >
      <h1>Todo List</h1>
      <div>
        {getGroups(data).map((group, groupPosition) => (
          <fieldset
            key={group.id}
            className={css`
              margin: 20rem 0;
              border: none;
              padding: 0;

              & > legend {
                font-weight: bold;
                width: 100%;
              }
            `}
          >
            <legend>
              <SingleLineTextInput
                placeholder="Untitled Group"
                ref={(el) =>
                  applyCursorLocation(el, "group", group.id, "title")
                }
                className={css`
                  width: 100%;
                `}
                value={group.title}
                onChange={(e) =>
                  updateGroupTitle(groupPosition, group, e.currentTarget.value)
                }
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      const delta = e.key === "ArrowUp" ? -1 : 1;
                      return moveCursorFromGroupTitle(
                        groupPosition,
                        group,
                        delta,
                      );
                    }
                  } else if (e.key === "Backspace") {
                    if (
                      (group.title === "" || e.metaKey || e.ctrlKey) &&
                      group.itemIds.length <= 1
                    ) {
                      e.preventDefault();
                      return removeGroup(groupPosition, group);
                    }
                  }
                }}
              />
            </legend>
            <div
              className={css`
                display: flex;
                flex-direction: column;
              `}
            >
              {getItemsInGroup(data, group.id).map((item, itemPosition) => (
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
                    onChange={() => toggleItemCompleted(item)}
                  />
                  <SingleLineTextInput
                    placeholder="Untitled Task"
                    ref={(el) =>
                      applyCursorLocation(el, "item", item.id, "title")
                    }
                    className={css`
                      width: 100%;
                    `}
                    value={item.title}
                    onChange={(e) =>
                      updateItemTitle(
                        group.id,
                        itemPosition,
                        item,
                        e.currentTarget.value,
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        if (!e.shiftKey) {
                          e.preventDefault();
                          const delta = e.key === "ArrowUp" ? -1 : 1;
                          return moveCursorFromItemTitle(
                            groupPosition,
                            group,
                            itemPosition,
                            delta,
                          );
                        }
                      } else if (e.key === "Backspace") {
                        if (item.title === "" || e.metaKey || e.ctrlKey) {
                          e.preventDefault();
                          return removeItem(group, itemPosition, item.id);
                        }
                        if (e.currentTarget.selectionEnd === 0) {
                          e.preventDefault();
                          return mergeWithPreviousItem(
                            group,
                            itemPosition,
                            item.id,
                          );
                        }
                      } else if (e.key === "Enter") {
                        if (e.metaKey || e.ctrlKey) {
                          e.preventDefault();
                          return toggleItemCompleted(item);
                        }
                      }
                    }}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <button onClick={() => addGroup()}>Add Group</button>
    </div>
  );

  function moveCursorFromGroupTitle(
    groupPosition: number,
    group: Group,
    delta: number,
  ) {
    return setData((currentData) => {
      if (delta > 0) {
        const nextFocusItem = getItemAt(currentData!, group.id, 0);
        if (nextFocusItem == null) {
          const nextGroup = getGroupAt(currentData!, groupPosition + 1);
          if (nextGroup == null) {
            return currentData;
          } else {
            setCursor("group", nextGroup.id, "title", "all");
          }
        } else {
          setCursor("item", nextFocusItem.id, "title", "all");
        }
      } else if (delta < 0) {
        const previousGroup = getGroupAt(currentData!, groupPosition - 1);
        if (previousGroup == null) {
          return currentData;
        } else {
          const nextFocusItem = getItemAt(
            currentData!,
            previousGroup.id,
            previousGroup.itemIds.length - 1,
          );
          if (nextFocusItem == null) {
            setCursor("group", previousGroup.id, "title", "all");
          } else {
            setCursor("item", nextFocusItem.id, "title", "all");
          }
        }
      }
      return currentData && { ...currentData };
    });
  }

  function moveCursorFromItemTitle(
    groupPosition: number,
    group: Group,
    itemPosition: number,
    delta: number,
  ) {
    return setData((currentData) => {
      const nextFocusItem = getItemAt(
        currentData!,
        group.id,
        itemPosition + delta,
      );
      if (nextFocusItem == null) {
        if (delta < 0) {
          setCursor("group", group.id, "title", "all");
        } else if (delta > 0) {
          const nextFocusGroup = getGroupAt(currentData!, groupPosition + 1);
          if (nextFocusGroup == null) return currentData;

          setCursor("group", nextFocusGroup.id, "title", "all");
        } else return currentData;
      } else {
        setCursor("item", nextFocusItem.id, "title", "all");
      }
      return currentData && { ...currentData };
    });
  }

  async function updateGroupTitle(
    groupPosition: number,
    group: Group,
    rawTitle: string,
  ) {
    // If the user pressed Enter, create a new group below.
    //
    // While the above is the most common case, this code will also handle the
    // user pasting text with newlines in it. In that case, additional groups or
    // items will be created for each additional line, depending on whether the
    // line starts with a list marker.
    const titleLines = rawTitle.split("\n");

    // If there are at least two lines, and the first line is empty, treat it as
    // a title for the group before this one.
    const titlesBefore: string[] = [];
    if (titleLines.length > 1 && titleLines[0]?.trim() === "") {
      titlesBefore.push(titleLines.shift()!);
    }
    const [groupTitle, ...titlesAfter] = titleLines;

    await setAndSaveData((currentData) => {
      let currentGroup = getGroup(currentData, group.id);
      currentData = upsertGroup(currentData, {
        ...currentGroup,
        title: groupTitle ?? "",
      });

      for (const title of titlesBefore) {
        const additionalGroupId = createId();
        currentData = upsertGroup(
          currentData,
          {
            id: additionalGroupId,
            title,
            itemIds: [],
          },
          groupPosition++,
        );
        setCursor("group", additionalGroupId, "title", title.length);
      }

      for (const title of titlesAfter) {
        if (title.trim() === "" && titlesAfter.length > 1) continue;

        let parsed = smartParseItemTitle(title ?? "");

        if (parsed.type == null) {
          const additionalGroupId = createId();
          currentGroup = {
            id: additionalGroupId,
            itemIds: [],
            ...parsed.fields,
          };
          currentData = upsertGroup(currentData, currentGroup, ++groupPosition);
          setCursor("group", additionalGroupId, "title", 0);
        } else if (parsed.type === "item") {
          const additionalItemId = createId();
          currentData = upsertItem(
            currentData,
            {
              id: additionalItemId,
              title: "",
              completedAt: undefined,
              ...parsed.fields,
            },
            currentGroup.id,
          );
          setCursor("item", additionalItemId, "title", 0);
        }
      }

      return currentData;
    });
  }

  async function addGroup() {
    await setAndSaveData((currentData) => {
      const groupId = createId();
      currentData = upsertGroup(currentData, {
        id: groupId,
        title: "",
        itemIds: [],
      });
      currentData = upsertItem(
        currentData,
        { id: createId(), title: "", completedAt: undefined },
        groupId,
      );
      return currentData;
    });
  }

  async function addItem(group: Group) {
    await setAndSaveData((currentData) =>
      upsertItem(
        currentData,
        { id: createId(), title: "", completedAt: undefined },
        group.id,
      ),
    );
  }

  async function removeGroup(groupPosition: number, group: Group) {
    await setAndSaveData((currentData) => {
      let nextFocusItem;
      let nextFocusGroup = getGroupAt(currentData, groupPosition - 1);
      if (nextFocusGroup) {
        nextFocusItem = getItemAt(
          currentData,
          nextFocusGroup.id,
          nextFocusGroup.itemIds.length - 1,
        );
      } else {
        // Maybe we're deleting the first group. In that case, try focusing the
        // next group instead.
        nextFocusGroup = getGroupAt(currentData, groupPosition + 1);
        if (nextFocusGroup == null) {
          return currentData;
        }
      }

      for (const itemId of group.itemIds) {
        currentData = deleteItem(currentData, itemId);
      }
      currentData = deleteGroup(currentData, group.id);

      if (nextFocusItem) {
        setCursor("item", nextFocusItem.id, "title", "all");
      } else {
        setCursor("group", nextFocusGroup.id, "title", "all");
      }
      return currentData;
    });
  }

  async function removeItem(group: Group, itemPosition: number, itemId: Id) {
    await setAndSaveData((currentData) => {
      let nextFocusItem = getItemAt(currentData, group.id, itemPosition - 1);
      if (nextFocusItem == null) {
        // Maybe we're deleting the first item in the group. In that case, try
        // focusing the next item instead.
        nextFocusItem = getItemAt(currentData, group.id, 1);
      }
      if (nextFocusItem) {
        setCursor(
          "item",
          nextFocusItem.id,
          "title",
          nextFocusItem.title.length,
        );
      } else {
        setCursor("group", group.id, "title", group.title.length);
      }

      currentData = deleteItem(currentData, itemId);
      return currentData;
    });
  }

  async function mergeWithPreviousItem(
    group: Group,
    itemPosition: number,
    itemId: Id,
  ) {
    await setAndSaveData((currentData) => {
      const currentItem = getItem(currentData, itemId);
      const previousItem = getItemAt(currentData, group.id, itemPosition - 1);
      if (previousItem == null) return currentData;

      currentData = deleteItem(currentData, itemId);
      currentData = upsertItem(currentData, {
        ...previousItem,
        title: previousItem.title + currentItem.title,
      });

      setCursor("item", previousItem.id, "title", previousItem.title.length);
      return currentData;
    });
  }

  function smartParseItemTitle(
    title: string,
  ):
    | { type: undefined; fields: { title: string } }
    | { type: "item"; fields: Partial<Item> } {
    const originalTitle = title;
    let checked: boolean | undefined = undefined;

    // If the title starts any Markdown <ul> character, remove it.
    title = title.replace(/^[-+*]\s+/, "");

    // If the title starts with a checkbox, parse and remove it.
    if (title.startsWith("[ ] ")) {
      title = title.slice(4);
      checked = false;
    } else if (title.startsWith("[x] ")) {
      title = title.slice(4);
      checked = true;
    }

    if (
      originalTitle.trim() === "" ||
      originalTitle !== title ||
      checked != null
    ) {
      const fields: Partial<Item> = { title };
      if (checked != null) {
        fields.completedAt = checked ? new Date().toJSON() : undefined;
      }

      return {
        type: "item",
        fields,
      };
    } else {
      return {
        type: undefined,
        fields: { title },
      };
    }
  }

  async function updateItemTitle(
    groupId: Id,
    itemPosition: number,
    item: Item,
    title: string,
  ) {
    // If the user pressed Enter, split this item into two items at the cursor
    // position. The first item will be the original item, and the second item
    // will be a new item with the text after the cursor.
    //
    // While the above is the most common case, this code will also handle the
    // user pasting text with newlines in it. In that case, the first item will
    // be the original item, and additional items will be created for each
    // additional line.
    const [currentTitle, ...additionalTitles] = title.split("\n");

    await setAndSaveData((currentData) => {
      currentData = upsertItem(currentData, {
        ...getItem(currentData, item.id),
        ...smartParseItemTitle(currentTitle ?? "").fields,
      });

      let additionalItemPosition = itemPosition + 1;
      for (const additionalTitle of additionalTitles) {
        const additionalItemId = createId();
        currentData = upsertItem(
          currentData,
          {
            id: additionalItemId,
            title: "",
            completedAt: undefined,
            ...smartParseItemTitle(additionalTitle ?? "").fields,
          },
          groupId,
          additionalItemPosition++,
        );

        setCursor("item", additionalItemId, "title", 0);
      }

      return currentData;
    });
  }

  function toggleItemCompleted(item: Item) {
    setAndSaveData((currentData) => {
      const currentItem = getItem(currentData, item.id);
      return upsertItem(currentData, {
        ...currentItem,
        completedAt: item.completedAt ? undefined : new Date().toJSON(),
      });
    });
  }
}
