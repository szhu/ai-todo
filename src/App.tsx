import { css, cx, keyframes } from "@emotion/css";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useEffect, useRef, useState } from "react";
import { getChatCompletion } from "./api/openai";
import Data, {
  Group,
  Id,
  Item,
  createId,
  deleteGroup,
  deleteItem,
  getGroup,
  getGroupAssert,
  getGroupAt,
  getGroups,
  getItem,
  getItemAssert,
  getItemAt,
  getItemsInGroup,
  toInstructText,
  toText,
  upsertGroup,
  upsertItem,
} from "./data/Data";
import debouncedSaveDataToGist from "./saving/debouncedSaveDataToGist";
import gistId from "./saving/gistId";
import loadDataFromGist from "./saving/loadDataFromGist";
import useSyncStateWithStorage from "./saving/useSyncStateWithStorage";
import copyToClipboard from "./util/clipboard/copyToClipboard";
import SingleLineTextInput from "./visual/SingleLineTextInput";

const highlight = keyframes`
  0% {
    background: #ffea0080;
  }

  5% {
    background: #ffea0021;
  }

  100% {
    background: transparent;
  }
`;

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

function getAiTidyInstructions(data: Data): string {
  const hasNewItems = getGroups(data).some(
    (group) => group.title.trim() === "" && group.itemIds.length > 0,
  );

  return hasNewItems
    ? "Group these tasks together into groups of 2-4 tasks. Don’t group them based on their purpose, group them based on which ones can be easily done together without extra context switching or physical relocation. Give each group a name, which should be the shared context or location. NOTE THAT YOU MUST STILL FOLLOW THE SAME FORMAT AS THE EXAMPLE."
    : "Look at the largest group(s). Move some of the tasks from the largest group(s) into existing small groups. If there aren't any small groups, create groups for this purpose. Don’t group tasks based on their purpose, group them based on which ones can be easily done together without extra context switching or physical relocation.";
}

function makeAiMessageText(data: Data, instructions: string): string {
  return `We will organize some to-do lists.

Here is the format to follow:


Example input:

100001 Fruits
- 100002 Apples
- 100003 Bananas

100004 Animals
- 100005 Cats
- 100006 Dogs

Here are new tasks for you to categorize:
- 100008 Spiders
- 100009 Birds
- 100009 Mosquitoes
- 100010 Starfish

Instructions: Categorize the new tasks into the existing categories. If there are no existing category that fit, create a new one.


Example output:

Move these tasks into 100004 Vertebrates
- 100009 Birds

Create a new category called “Invertebrates”
- 100008 Spiders
- 100009 Mosquitoes
- 100010 Starfish


IMPORTANT NOTES:
- We renamed the category “Animals” to “Vertebrates” by referencing the same ID.
- “Fruits” is NOT in the output because it didn't change.
- Move these tasks” and “Create a new category” are the only valid instructions. Everything else will cause the entire output to be ignored.


Real input:

${toInstructText(data)}

Instructions: ${instructions}. Don't create categories larger than 4 tasks.


Let me know what the output should be.`;
}

function applyAiAction(data: Data, response: string) {
  const updatedIds = new Set<Id>();

  const lines = response.split(/\s*\n\s*/g);
  let currentGroup: Group | undefined = undefined;
  for (const line of lines) {
    const groupIdAndNewGroupNameMatch = //
      line.match(/Move these tasks into (\d\d\d\d+)\s+(.*)/);
    if (groupIdAndNewGroupNameMatch != null) {
      const [, groupId, newGroupTitle] = groupIdAndNewGroupNameMatch;
      currentGroup = getGroup(data, groupId as Id);
      if (currentGroup) {
        if (currentGroup.title.startsWith("!")) {
          currentGroup = undefined;
        } else if (newGroupTitle && currentGroup.title !== newGroupTitle) {
          data = upsertGroup(data, {
            ...currentGroup,
            title: newGroupTitle,
          });
          updatedIds.add(currentGroup.id);
        }
      }
      continue;
    }

    const newGroupName = //
      line.match(/Create a new category called\s+[“"]?(.*?)[”"]?$/)?.[1];
    if (newGroupName != null) {
      const newGroup = {
        id: createId(),
        title: newGroupName,
        itemIds: [],
      };
      data = upsertGroup(data, newGroup);
      currentGroup = newGroup;
      updatedIds.add(newGroup.id);
      continue;
    }

    const itemId = line.match(/- (\d\d\d\d+)\b/)?.[1];
    if (itemId != null && currentGroup != null) {
      const item = getItem(data, itemId);
      if (item && !item.title.startsWith("!")) {
        data = upsertItem(data, item, currentGroup.id);
        updatedIds.add(itemId);
      }
      continue;
    }

    currentGroup = undefined;
  }

  // Remove all empty groups
  for (const group of getGroups(data)) {
    if (/*group.title.trim() === "" &&*/ group.itemIds.length === 0) {
      data = deleteGroup(data, group.id);
    }
  }

  return [data, updatedIds] as const;
}

export function App() {
  const [data, setData] = useState<Data | undefined>(undefined);
  const [loadData, setAndSaveData] = useSyncStateWithStorage<Data>(
    setData as React.Dispatch<React.SetStateAction<Data>>,
    loadDataFromGist,
    async (data: Data | undefined) => {
      setSaveState("dirty");
      await debouncedSaveDataToGist(data, () => {
        setSaveState("saving");
      })
        .then(() => setSaveState("ok"))
        .catch(() => setSaveState("error"));
    },
  );
  const [updatedIds, setUpdatedItemIds] = useState<Set<Id>>(new Set());
  const [githubToken, setGithubToken] = useLocalStorage("GITHUB_ACCESS_TOKEN");
  const [openaiToken, setOpenaiToken] = useLocalStorage("OPENAI_API_KEY");

  const [saveState, setSaveState] = //
    useState<"ok" | "dirty" | "saving" | "error">("ok");

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

  return (
    <div>
      <div
        className={css`
          padding: 20rem 20rem 10rem;
          position: sticky;
          z-index: 1;
          top: 0;
          background: Canvas;
          box-shadow: 0 0 2rem rgba(0, 0, 0, 0.3);
        `}
      >
        <div
          className={css`
            float: right;
            display: flex;
            align-items: center;
            gap: 12rem;
            margin-bottom: 8rem;

            white-space: nowrap;
            max-width: 100%;
            overflow: auto hidden;
          `}
        >
          <div
            className={css`
              color: ${saveState === "error" ? "red" : "gray"};
              font-style: italic;
            `}
          >
            {
              {
                ok: <>Saved</>,
                dirty: <>Not Saved</>,
                saving: <>Saving&hellip;</>,
                error: <>Error Saving</>,
              }[saveState]
            }
          </div>

          <button
            onClick={(e) => {
              (
                e.currentTarget.nextElementSibling as HTMLDialogElement
              ).showModal();
            }}
          >
            ⚙️
          </button>
          <dialog
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                e.currentTarget.close();
              }
            }}
            className={css`
              white-space: initial;
              border: none;
              box-shadow: 0rem 3rem 10rem rgba(0, 0, 0, 0.3);
              border-radius: 4rem;
              width: 300rem;
              padding: 0;
            `}
          >
            <div
              className={css`
                padding: 20rem;
                display: flex;
                flex-direction: column;
                gap: 20rem;
              `}
            >
              <fieldset
                className={css`
                  display: flex;
                  flex-direction: column;
                  padding: 16rem;
                  gap: 12rem;
                `}
              >
                <legend
                  className={css`
                    font-weight: bold;
                  `}
                >
                  Export Data
                </legend>
                {data && (
                  <button onClick={() => copyToClipboard(toText(data))}>
                    📑 Copy to Clipboard
                  </button>
                )}
                <button
                  onClick={() => {
                    window.open(`https://gist.github.com/${gistId}`, "_blank");
                  }}
                >
                  🌐 View Data on GitHub
                </button>
              </fieldset>
              <fieldset
                className={css`
                  display: flex;
                  flex-direction: column;
                  padding: 16rem;
                  gap: 12rem;
                `}
              >
                <legend
                  className={css`
                    font-weight: bold;
                  `}
                >
                  GitHub
                </legend>{" "}
                <div>Logging in with GitHub lets you save your changes.</div>
                <div>Changes are saved every 6 secs.</div>
                {githubToken ? (
                  <button
                    onClick={async () => {
                      await new Promise(requestAnimationFrame);
                      const result = confirm("Log out of GitHub?");
                      if (result) {
                        setGithubToken(undefined);
                      }
                    }}
                  >
                    🚪 Log Out
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        const dateString = new Date().toLocaleDateString("sv");
                        window.open(
                          `https://github.com/settings/tokens/new?description=AI+Todo+${dateString}+&scopes=gist`,
                          "_blank",
                        );
                      }}
                    >
                      🔑 Generate Key
                    </button>
                    <button
                      onClick={async () => {
                        await new Promise(requestAnimationFrame);
                        const input = prompt("Enter GitHub access token");
                        if (input) {
                          setGithubToken(input);
                        }
                      }}
                    >
                      📝 Enter Generated Key
                    </button>
                  </>
                )}
              </fieldset>
              <fieldset
                className={css`
                  display: flex;
                  flex-direction: column;
                  padding: 16rem;
                  gap: 12rem;
                `}
              >
                <legend
                  className={css`
                    font-weight: bold;
                  `}
                >
                  OpenAI
                </legend>
                <div>
                  Logging in with OpenAI lets you use the AI action buttons.
                </div>
                {openaiToken ? (
                  <button
                    onClick={async () => {
                      await new Promise(requestAnimationFrame);
                      const result = confirm("Log out of OpenAI?");
                      if (result) {
                        setOpenaiToken(undefined);
                      }
                    }}
                  >
                    🚪 Log Out
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        window.open(
                          `https://platform.openai.com/api-keys`,
                          "_blank",
                        );
                      }}
                    >
                      🔑 Generate Key
                    </button>
                    <button
                      onClick={async () => {
                        await new Promise(requestAnimationFrame);
                        const input = prompt("Enter OpenAI API key");
                        if (input) {
                          setOpenaiToken(input);
                        }
                      }}
                    >
                      📝 Enter Generated Key
                    </button>
                  </>
                )}
              </fieldset>
            </div>
          </dialog>
        </div>
        <h1
          className={css`
            margin: 0;
          `}
        >
          <span
            className={css`
              display: inline-block;
            `}
          >
            {data ? <>Todo List</> : <>Loading&hellip;</>}
          </span>
        </h1>
      </div>
      <div
        className={css`
          padding: 0rem 20rem 40rem;
        `}
      >
        {data && (
          <div>
            {getGroups(data).map((group, groupPosition) => (
              <fieldset
                key={group.id}
                className={css`
                  margin: 20rem 0;
                  border: none;
                  padding: 0;

                  & > legend {
                    padding: 0;
                    margin: 0;
                    font-weight: bold;
                    width: 100%;
                  }
                `}
              >
                <legend
                  className={cx(
                    updatedIds.has(group.id) &&
                      css`
                        animation: ${highlight} 100s ease-in;
                      `,
                  )}
                >
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
                      updateGroupTitle(
                        groupPosition,
                        group,
                        e.currentTarget.value,
                      )
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
                      className={cx(
                        css`
                          display: flex;

                          & > * {
                            opacity: ${item.completedAt ? 0.5 : 1};
                          }
                        `,
                        updatedIds.has(item.id) &&
                          css`
                            animation: ${highlight} 100s ease-in;
                          `,
                      )}
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
                          text-decoration: ${item.completedAt
                            ? "line-through"
                            : "none"};
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
                            const isEntirelySelected =
                              e.currentTarget.selectionStart === 0 &&
                              e.currentTarget.selectionEnd ===
                                e.currentTarget.value.length;
                            if (
                              item.title === "" ||
                              isEntirelySelected ||
                              e.metaKey ||
                              e.ctrlKey
                            ) {
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
        )}

        {data && (
          <div
            className={css`
              display: flex;
              flex-direction: column;
              gap: 8rem;
            `}
          >
            <div
              className={css`
                display: flex;
                gap: 8rem;
              `}
            >
              <button onClick={() => addGroup()}>➕ Add Group</button>
              <button
                disabled={openaiToken == null}
                onClick={async () => {
                  const instructions = getAiTidyInstructions(data);
                  const request = makeAiMessageText(data, instructions);
                  console.log(request);
                  const response = await getChatCompletion(request);
                  console.log(response);
                  setAndSaveData((currentData) => {
                    const [newData, updatedItemIds] = applyAiAction(
                      currentData,
                      response,
                    );
                    setUpdatedItemIds(updatedItemIds);
                    return newData;
                  });
                }}
              >
                ✨ AI Organize
              </button>
              <button
                disabled={openaiToken == null}
                onClick={async () => {
                  await new Promise(requestAnimationFrame);
                  const instructions = prompt(
                    "Enter custom instructions here",
                    "Pick 1-3 tasks and move them into a new group called called 'Todo Today'.",
                  );
                  if (!instructions) return;

                  const request = makeAiMessageText(data, instructions);
                  console.log(request);
                  const response = await getChatCompletion(request);
                  console.log(response);
                  setAndSaveData((currentData) => {
                    const [newData, updatedItemIds] = applyAiAction(
                      currentData,
                      response,
                    );
                    setUpdatedItemIds(updatedItemIds);
                    return newData;
                  });
                }}
              >
                ⚡️ AI &hellip;
              </button>
            </div>
            <div
              className={css`
                font-size: smaller;
                opacity: 0.8;
              `}
            >
              Tip: Add a ! at the beginning of a task name to prevent it from
              being moved by AI actions. Add a ! at the beginning of a group
              name to prevent items from being moved into it.
            </div>
          </div>
        )}
      </div>
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
      let currentGroup = getGroupAssert(currentData, group.id);
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

        let parsed = smartParseTitle(title ?? "");

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
      const currentItem = getItemAssert(currentData, itemId);
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

  type ParsedItem = Pick<Item, "title"> | Pick<Item, "title" | "completedAt">;
  function smartParseTitle(
    title: string,
  ):
    | { type: undefined; fields: { title: string } }
    | { type: "item"; fields: ParsedItem } {
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
      let fields: ParsedItem = {
        title,
        ...(checked != null
          ? { completedAt: checked ? new Date().toJSON() : undefined }
          : {}),
      };

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
        ...getItemAssert(currentData, item.id),
        ...smartParseTitle(currentTitle ?? "").fields,
      });

      let additionalItemPosition = itemPosition + 1;
      for (const additionalTitle of additionalTitles) {
        const additionalItemId = createId();
        currentData = upsertItem(
          currentData,
          {
            id: additionalItemId,
            completedAt: undefined,
            ...smartParseTitle(additionalTitle ?? "").fields,
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
      return upsertItem(currentData, {
        ...getItemAssert(currentData, item.id),
        completedAt: item.completedAt ? undefined : new Date().toJSON(),
      });
    });
  }
}
