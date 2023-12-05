export type Id = string & { type?: "Id" };

export interface Item {
  id: Id;
  title: string;
  completedAt: Date | undefined;
}

export interface Group {
  id: Id;
  title: string;
  itemIds: Id[];
}

export default interface Data {
  Item: Record<Id, Item>;
  groupIds: Id[];
  Group: Record<Id, Group>;
}

export const BlankData: Data = {
  Group: {},
  Item: {},
  groupIds: [],
};

// Helpers:

export function createId() {
  const nDigits = 6;
  return Math.floor(Math.random() * 10 ** nDigits)
    .toString()
    .padStart(nDigits) as Id;
}

function isId(x: unknown): x is Id {
  return typeof x === "string";
}

function upsertRecordInDb<T extends { id: Id }>(
  db: Record<Id, T>,
  recordOrId: Id | T,
): Record<Id, T> {
  const id = isId(recordOrId) ? recordOrId : recordOrId.id;
  const newRecord = isId(recordOrId) ? undefined : recordOrId;

  if (newRecord == null) {
    // If the record is already in the db and no update was requested, return
    // the db unchanged.
    if (db[id]) {
      return db;
    } else {
      throw new Error("Record not found: " + id);
    }
  }

  return { ...db, [id]: newRecord };
}

function insertOrMoveToPosition<T>(
  array: T[],
  item: T,
  position?: number,
): T[] {
  if (position == null && array.includes(item)) return array;

  if (position == null) {
    position = array.length;
  } else if (position < 0) {
    position = array.length + position;
  }

  if (array[position] === item) return array;

  const newArray = array.filter((x) => x !== item);
  newArray.splice(position, 0, item);
  return newArray;
}

// Actions:

export function getItem(data: Data, itemId: Id): Item {
  const item = data.Item[itemId];
  if (item == null) throw new Error("Invalid item: " + itemId);
  return item;
}

export function getItemsInGroup(data: Data, groupId: Id): Item[] {
  const group = getGroup(data, groupId);
  return group.itemIds.map((itemId) => getItem(data, itemId));
}

export function getGroup(data: Data, groupId: Id): Group {
  const group = data.Group[groupId];
  if (group == null) throw new Error("Invalid group: " + groupId);
  return group;
}

export function getGroups(data: Data): Group[] {
  return data.groupIds.map((groupId) => getGroup(data, groupId));
}

export function upsertItem(
  data: Data,
  itemOrId: Id | Item,
  groupId?: Id,
  position?: number,
): Data {
  const itemId = isId(itemOrId) ? itemOrId : itemOrId.id;

  const Item = upsertRecordInDb(data.Item, itemOrId);
  if (Item !== data.Item) {
    data = { ...data, Item };
  }

  if (groupId != null) {
    data = removeItemFromAllGroups(data, itemId);

    const group = getGroup(data, groupId);
    const itemIds = insertOrMoveToPosition(group.itemIds, itemId, position);
    if (itemIds !== group.itemIds) {
      const Group = upsertRecordInDb(data.Group, { ...group, itemIds });
      data = { ...data, Group };
    }
  }

  return data;
}

export function removeItemFromAllGroups(data: Data, itemId: Id): Data {
  const Group = { ...data.Group };
  for (const group of Object.values(Group)) {
    const itemIds = group.itemIds.filter((id) => id !== itemId);
    if (itemIds !== group.itemIds) {
      Group[group.id] = { ...group, itemIds };
    }
  }
  if (Group !== data.Group) {
    data = { ...data, Group };
  }

  return data;
}

export function deleteItem(data: Data, itemId: Id): Data {
  const Item = { ...data.Item };
  delete Item[itemId];
  if (Item !== data.Item) {
    data = { ...data, Item };
  }

  data = removeItemFromAllGroups(data, itemId);

  return data;
}

export function upsertGroup(data: Data, group: Group, position?: number): Data {
  const Group = upsertRecordInDb(data.Group, group);
  if (Group !== data.Group) {
    data = { ...data, Group };
  }

  const groupIds = insertOrMoveToPosition(data.groupIds, group.id, position);
  if (groupIds !== data.groupIds) {
    data = { ...data, groupIds };
  }

  return data;
}

export function deleteGroup(data: Data, groupId: Id): Data {
  const Group = { ...data.Group };
  delete Group[groupId];
  if (Group !== data.Group) {
    data = { ...data, Group };
  }

  return data;
}
