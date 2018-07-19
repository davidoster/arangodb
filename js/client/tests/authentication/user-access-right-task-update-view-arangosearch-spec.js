/* jshint globalstrict:true, strict:true, maxlen: 5000 */
/* global describe, before, after, it, require*/

// //////////////////////////////////////////////////////////////////////////////
// / @brief tests for user access rights
// /
// / @file
// /
// / DISCLAIMER
// /
// / Copyright 2018 ArangoDB GmbH, Cologne, Germany
// /
// / Licensed under the Apache License, Version 2.0 (the "License");
// / you may not use this file except in compliance with the License.
// / You may obtain a copy of the License at
// /
// /     http://www.apache.org/licenses/LICENSE-2.0
// /
// / Unless required by applicable law or agreed to in writing, software
// / distributed under the License is distributed on an "AS IS" BASIS,
// / WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// / See the License for the specific language governing permissions and
// / limitations under the License.
// /
// / Copyright holder is ArangoDB GmbH, Cologne, Germany
// /
// / @author Vadim Kondratyev
// / @author Copyright 2018, ArangoDB GmbH, Cologne, Germany
// //////////////////////////////////////////////////////////////////////////////

'use strict';

const expect = require('chai').expect;
const users = require('@arangodb/users');
const helper = require('@arangodb/user-helper');
const tasks = require('@arangodb/tasks');
const pu = require('@arangodb/process-utils');
const download = require('internal').download;
const errors = require('@arangodb').errors;
const db = require('@arangodb').db;
const namePrefix = helper.namePrefix;
const dbName = helper.dbName;
const rightLevels = helper.rightLevels;
const testView1Name = `${namePrefix}View1New`;
const testView2Name = `${namePrefix}View2New`;
const testViewType = "arangosearch";
const testCol1Name = `${namePrefix}Col1New`;
const testCol2Name = `${namePrefix}Col2New`;
const keySpaceId = 'task_update_view_keyspace';

const userSet = helper.userSet;
const systemLevel = helper.systemLevel;
const dbLevel = helper.dbLevel;
const colLevel = helper.colLevel;

const arango = require('internal').arango;
for (let l of rightLevels) {
  systemLevel[l] = new Set();
  dbLevel[l] = new Set();
  colLevel[l] = new Set();
}

const wait = (keySpaceId, key) => {
  for (let i = 0; i < 200; i++) {
    if (getKey(keySpaceId, key)) break;
    require('internal').wait(0.1);
  }
};

const createKeySpace = (keySpaceId) => {
  return executeJS(`return global.KEYSPACE_CREATE('${keySpaceId}', 128, true);`).body === 'true';
};

const dropKeySpace = (keySpaceId) => {
  executeJS(`global.KEYSPACE_DROP('${keySpaceId}');`);
};

const getKey = (keySpaceId, key) => {
  return executeJS(`return global.KEY_GET('${keySpaceId}', '${key}');`).body === 'true';
};

const setKey = (keySpaceId, name) => {
  return executeJS(`global.KEY_SET('${keySpaceId}', '${name}', false);`);
};

const executeJS = (code) => {
  let httpOptions = pu.makeAuthorizationHeaders({
    username: 'root',
    password: ''
  });
  httpOptions.method = 'POST';
  httpOptions.timeout = 1800;
  httpOptions.returnBodyOnError = true;
  return download(arango.getEndpoint().replace('tcp', 'http') + `/_db/${dbName}/_admin/execute?returnAsJSON=true`,
    code,
    httpOptions);
};

helper.switchUser('root', '_system');
helper.removeAllUsers();
helper.generateAllUsers();

describe('User Rights Management', () => {
  it('should check if all users are created', () => {
    helper.switchUser('root', '_system');
    expect(userSet.size).to.be.greaterThan(0); 
    expect(userSet.size).to.equal(helper.userCount);
    for (let name of userSet) {
      expect(users.document(name), `Could not find user: ${name}`).to.not.be.undefined;
    }
  });

  it('should test rights for', () => {
    expect(userSet.size).to.be.greaterThan(0);
    for (let name of userSet) {
      let canUse = false;
      try {
        helper.switchUser(name, dbName);
        canUse = true;
      } catch (e) {
        canUse = false;
      }

      if (canUse) {
        describe(`user ${name}`, () => {
          before(() => {
            helper.switchUser(name, dbName);
            expect(createKeySpace(keySpaceId)).to.equal(true, 'keySpace creation failed!');
          });

          after(() => {
            dropKeySpace(keySpaceId);
          });

          describe('administrate on db level', () => {
            const rootTestCollection = (colName, switchBack = true) => {
              helper.switchUser('root', dbName);
              let col = db._collection(colName);
              if (switchBack) {
                  helper.switchUser(name, dbName);
              }
              return col !== null;
            };

            const rootCreateCollection = (colName) => {
              if (!rootTestCollection(colName, false)) {
                db._create(colName);
                if (colLevel['none'].has(name)) {
                  if (helper.isLdapEnabledExternal()) {
                    users.grantCollection(':role:' + name, dbName, colName, 'none');
                  } else {
                    users.grantCollection(name, dbName, colName, 'none');
                  }
                } else if (colLevel['ro'].has(name)) {
                  if (helper.isLdapEnabledExternal()) {
                    users.grantCollection(':role:' + name, dbName, colName, 'ro');
                  } else {
                    users.grantCollection(name, dbName, colName, 'ro');
                  }
                } else if (colLevel['rw'].has(name)) {
                  if (helper.isLdapEnabledExternal()) {
                    users.grantCollection(':role:' + name, dbName, colName, 'rw');
                  } else {
                    users.grantCollection(name, dbName, colName, 'rw');
                  }
                }
              }
              helper.switchUser(name, dbName);
            };

            const rootPrepareCollection = (colName, numDocs = 1, defKey = true) => {
                if (rootTestCollection(colName, false)) {
                  db._collection(colName).truncate({ compact: false });
                  for(var i = 0; i < numDocs; ++i)
                  {
                    var doc = {prop1: colName + "_1", propI: i, plink: "lnk" + i}
                    if (!defKey) {
                      doc._key = colName + i;
                    }
                    db._collection(colName).save(doc, {waitForSync: true});
                  }
                }
                helper.switchUser(name, dbName);
            };

            const rootGrantCollection = (colName, user, explicitRight) => {
              if (rootTestCollection(colName, false)) {
                if (explicitRight !== '' && rightLevels.includes(explicitRight))
                {
                  if (helper.isLdapEnabledExternal()) {
                    users.grantCollection(':role:' + user, dbName, colName, explicitRight);
                  } else {
                    users.grantCollection(user, dbName, colName, explicitRight);
                  }
                }
              helper.switchUser(user, dbName);
              }
            };

            const rootDropCollection = (colName) => {
              helper.switchUser('root', dbName);
              try {
                db._collection(colName).drop();
              } catch (ignored) { }
              helper.switchUser(name, dbName);
            };

            const rootTestView = (viewName, switchBack = true) => {
              helper.switchUser('root', dbName);
              let view = db._view(viewName);
              if (switchBack) {
                  helper.switchUser(name, dbName);
              }
              return view != null;
            };

            const rootGetViewProps = (viewName, switchBack = true) => {
              helper.switchUser('root', dbName);
              let properties = db._view(viewName).properties();
              if (switchBack) {
                  helper.switchUser(name, dbName);
              }
              return properties;
            };

            const rootCreateView = (viewName, links = null) => {
              if (rootTestView(viewName, false)) {
                db._dropView(viewName);
              }
              let view =  db._createView(viewName, testViewType, {});
              if (links != null) {
                view.properties(links, false);
              }
              helper.switchUser(name, dbName);
            };

            const rootGetDefaultViewProps = () => {
              helper.switchUser('root', dbName);
              try {
                var tmpView = db._createView(this.title+"_tmpView");
                var properties = tmpView.properties();
                db._dropView(this.title+"_tmpView");
              } catch (ignored) { }
              helper.switchUser(name, dbName);
              return properties;
            };

            const rootDropView = (viewName) => {
              helper.switchUser('root', dbName);
              try {
                db._dropView(viewName);
              } catch (ignored) { }
              helper.switchUser(name, dbName);
            };

            describe('update a', () => {
              before(() => {
                db._useDatabase(dbName);
                rootCreateCollection(testCol1Name);
                rootCreateCollection(testCol2Name);
                rootPrepareCollection(testCol1Name);
                rootPrepareCollection(testCol2Name);
                rootCreateView(testView1Name, {links: { [testCol1Name] : {includeAllFields: true }}});
              });

              after(() => {
                rootDropView(testView1Name);
                rootDropView(testView2Name);
                rootDropCollection(testCol1Name);
                rootDropCollection(testCol2Name);
              });

              it('view by name', () => {
                expect(rootTestView(testView1Name)).to.equal(true, 'Precondition failed, view was not found');
                setKey(keySpaceId, name);
                const taskId = 'task_update_view_name_' + name;
                const task = {
                  id: taskId,
                  name: taskId,
                  command: `(function (params) {
                    try {
                      const db = require('@arangodb').db;
                      db._view(${testView1Name}).rename(${testView2Name});
                      global.KEY_SET('${keySpaceId}', '${name}_status', true);
                    } catch (e) {
                      global.KEY_SET('${keySpaceId}', '${name}_status', false);
                    } finally {
                      global.KEY_SET('${keySpaceId}', '${name}', true);
                    }
                  })(params);`
                };
                if (dbLevel['rw'].has(name)) {
                  tasks.register(task);
                  wait(keySpaceId, name);
                  expect(getKey(keySpaceId, `${name}_status`)).to.equal(true, `${name} could not update the view with sufficient rights`);
                  expect(rootTestView(testView2Name)).to.equal(true, 'View renaming reported success, but updated view was not found afterwards');
                } else {
                  try {
                    tasks.register(task);
                    expect(false).to.equal(true, `${name} managed to register a task with insufficient rights`);
                  } catch (e) {
                    expect(e.errorNum).to.equal(errors.ERROR_FORBIDDEN.code, "Expected to get forbidden error code, but got another one");
                  }
                }
              });

              it('view by property update except links (partial)', () => {
                expect(rootTestView(testView1Name)).to.equal(true, 'Precondition failed, view was not found');
                setKey(keySpaceId, name);
                const taskId = 'task_update_view_property_not_links_partial_' + name;
                const task = {
                  id: taskId,
                  name: taskId,
                  command: `(function (params) {
                    try {
                      const db = require('@arangodb').db;
                      db._view(${testView1Name}).properties({\"locale\" : \"de_DE.UTF-8\"}, true);
                      global.KEY_SET('${keySpaceId}', '${name}_status', true);
                    } catch (e) {
                      global.KEY_SET('${keySpaceId}', '${name}_status', false);
                    }finally {
                      global.KEY_SET('${keySpaceId}', '${name}', true);
                    }
                  })(params);`
                };
                if (dbLevel['rw'].has(name)) {
                  tasks.register(task);
                  wait(keySpaceId, name);
                  expect(getKey(keySpaceId, `${name}_status`)).to.equal(true, `${name} could not update the view with sufficient rights`);
                  expect(rootGetViewProps(testView1Name)["locale"]).to.equal("de_DE.UTF-8", 'View property update reported success, but property was not updated');
                } else {
                  try {
                    tasks.register(task);
                    expect(false).to.equal(true, `${name} managed to register a task with insufficient rights`);
                  } catch (e) {
                    expect(e.errorNum).to.equal(errors.ERROR_FORBIDDEN.code, "Expected to get forbidden error code, but got another one");
                  }
                }
              });

              it('view by property update except links (full)', () => {
                expect(rootTestView(testView1Name)).to.equal(true, 'Precondition failed, view was not found');
                setKey(keySpaceId, name);
                const taskId = 'task_update_view_property_not_links_full_' + name;
                const task = {
                  id: taskId,
                  name: taskId,
                  command: `(function (params) {
                    try {
                      const db = require('@arangodb').db;
                      db._view(${testView1Name}).properties({\"locale\" : \"de_DE.UTF-8\"}, false);
                      global.KEY_SET('${keySpaceId}', '${name}_status', true);
                    } catch (e) {
                      global.KEY_SET('${keySpaceId}', '${name}_status', false);
                    }finally {
                      global.KEY_SET('${keySpaceId}', '${name}', true);
                    }
                  })(params);`
                };
                if (dbLevel['rw'].has(name)) {
                  tasks.register(task);
                  wait(keySpaceId, name);
                  expect(getKey(keySpaceId, `${name}_status`)).to.equal(true, `${name} could not update the view with sufficient rights`);
                  expect(rootGetViewProps(testView1Name)["locale"]).to.equal("de_DE.UTF-8", 'View property update reported success, but property was not updated');
                } else {
                  try {
                    tasks.register(task);
                    expect(false).to.equal(true, `${name} managed to register a task with insufficient rights`);
                  } catch (e) {
                    expect(e.errorNum).to.equal(errors.ERROR_FORBIDDEN.code, "Expected to get forbidden error code, but got another one");
                  }
                }
              });

              it('view by properties remove (full)', () => {
                expect(rootTestView(testView1Name)).to.equal(true, 'Precondition failed, view was not found');
                setKey(keySpaceId, name);
                const taskId = 'task_update_view_property_remove_full_' + name;
                const task = {
                  id: taskId,
                  name: taskId,
                  command: `(function (params) {
                    try {
                      const db = require('@arangodb').db;
                      db._view(${testView1Name}).properties({}, false);
                      global.KEY_SET('${keySpaceId}', '${name}_status', true);
                    } catch (e) {
                      global.KEY_SET('${keySpaceId}', '${name}_status', false);
                    }finally {
                      global.KEY_SET('${keySpaceId}', '${name}', true);
                    }
                  })(params);`
                };
                if (dbLevel['rw'].has(name)) {
                  if(dbLevel['rw'].has(name) && colLevel['rw'].has(name)){
                    tasks.register(task);
                    wait(keySpaceId, name);
                    expect(getKey(keySpaceId, `${name}_status`)).to.equal(true, `${name} could not update the view with sufficient rights`);
                    expect(rootGetViewProps(testView1Name)).to.deep.equal(rootGetDefaultViewProps(), 'View properties update reported success, but properties were not updated');
                  } else {
                    tasks.register(task);
                    wait(keySpaceId, name);
                    expect(getKey(keySpaceId, `${name}_status`)).to.equal(false, `${name} could update the view with insufficient rights`);
                  }
                } else {
                  try {
                    tasks.register(task);
                    expect(false).to.equal(true, `${name} managed to register a task with insufficient rights`);
                  } catch (e) {
                    expect(e.errorNum).to.equal(errors.ERROR_FORBIDDEN.code, "Expected to get forbidden error code, but got another one");
                  }
                }
              });

              it('view by existing link update (partial)', () => {
                expect(rootTestView(testView1Name)).to.equal(true, 'Precondition failed, view was not found');
                setKey(keySpaceId, name);
                const taskId = 'task_update_view_existing_link_partial_' + name;
                const task = {
                  id: taskId,
                  name: taskId,
                  command: `(function (params) {
                    try {
                      const db = require('@arangodb').db;
                      db._view(${testView1Name}).properties({ links: { [${testCol1Name}]: { includeAllFields: true, analyzers: [\"text_de\",\"text_en\"] } } }, true);
                      global.KEY_SET('${keySpaceId}', '${name}_status', true);
                    } catch (e) {
                      global.KEY_SET('${keySpaceId}', '${name}_status', false);
                    }finally {
                      global.KEY_SET('${keySpaceId}', '${name}', true);
                    }
                  })(params);`
                };
                if (dbLevel['rw'].has(name)) {
                  if(dbLevel['rw'].has(name) && colLevel['rw'].has(name))
                  {
                    tasks.register(task);
                    wait(keySpaceId, name);
                    expect(getKey(keySpaceId, `${name}_status`)).to.equal(true, `${name} could not update the view with sufficient rights`);
                    expect(rootGetViewProps(testView1Name)["links"][testCol1Name]["analyzers"]).to.eql(["text_de","text_en"], 'View link update reported success, but property was not updated');
                  } else {
                    tasks.register(task);
                    wait(keySpaceId, name);
                    expect(getKey(keySpaceId, `${name}_status`)).to.equal(false, `${name} could update the view with insufficient rights`);
                  }
                } else {
                  try {
                    tasks.register(task);
                    expect(false).to.equal(true, `${name} managed to register a task with insufficient rights`);
                  } catch (e) {
                    expect(e.errorNum).to.equal(errors.ERROR_FORBIDDEN.code, "Expected to get forbidden error code, but got another one");
                  }
                }
              });

              it('view by existing link update (full)', () => {
                expect(rootTestView(testView1Name)).to.equal(true, 'Precondition failed, view was not found');
                setKey(keySpaceId, name);
                const taskId = 'task_update_view_existing_link_full_' + name;
                const task = {
                  id: taskId,
                  name: taskId,
                  command: `(function (params) {
                    try {
                      const db = require('@arangodb').db;
                      db._view(${testView1Name}).properties({ links: { [${testCol1Name}]: { includeAllFields: true, analyzers: [\"text_de\",\"text_en\"] } } }, false);
                      global.KEY_SET('${keySpaceId}', '${name}_status', true);
                    } catch (e) {
                      global.KEY_SET('${keySpaceId}', '${name}_status', false);
                    }finally {
                      global.KEY_SET('${keySpaceId}', '${name}', true);
                    }
                  })(params);`
                };
                if (dbLevel['rw'].has(name) && colLevel['rw'].has(name)) {
                  if(dbLevel['rw'].has(name) && colLevel['rw'].has(name)) {
                    tasks.register(task);
                    wait(keySpaceId, name);
                    expect(getKey(keySpaceId, `${name}_status`)).to.equal(true, `${name} could not update the view with sufficient rights`);
                    expect(rootGetViewProps(testView1Name)["links"][testCol1Name]["analyzers"]).to.eql(["text_de","text_en"], 'View link update reported success, but property was not updated');
                  } else {
                    tasks.register(task);
                    wait(keySpaceId, name);
                    expect(getKey(keySpaceId, `${name}_status`)).to.equal(false, `${name} could update the view with insufficient rights`);
                  }
                } else {
                  try {
                    tasks.register(task);
                    expect(false).to.equal(true, `${name} managed to register a task with insufficient rights`);
                  } catch (e) {
                    expect(e.errorNum).to.equal(errors.ERROR_FORBIDDEN.code, "Expected to get forbidden error code, but got another one");
                  }
                }
              });

              it('view by new link to RW collection (partial)', () => {
                expect(rootTestView(testView1Name)).to.equal(true, 'Precondition failed, view was not found');
                rootGrantCollection(testCol2Name, name, 'rw');
                setKey(keySpaceId, name);
                const taskId = 'task_update_view_new_link_to_RW_coll_partial_' + name;
                const task = {
                  id: taskId,
                  name: taskId,
                  command: `(function (params) {
                    try {
                      const db = require('@arangodb').db;
                      db._view(${testView1Name}).properties({ links: { [${testCol2Name}]: { includeAllFields: true, analyzers: [\"text_de\"] } } }, true);
                      global.KEY_SET('${keySpaceId}', '${name}_status', true);
                    } catch (e) {
                      global.KEY_SET('${keySpaceId}', '${name}_status', false);
                    }finally {
                      global.KEY_SET('${keySpaceId}', '${name}', true);
                    }
                  })(params);`
                };
                if (dbLevel['rw'].has(name)) {
                  tasks.register(task);
                  wait(keySpaceId, name);
                  expect(getKey(keySpaceId, `${name}_status`)).to.equal(true, `${name} could not update the view with sufficient rights`);
                  expect(rootGetViewProps(testView1Name)["links"][testCol2Name]["analyzers"]).to.eql(["text_de"], 'View link update reported success, but property was not updated');
                } else {
                  try {
                    tasks.register(task);
                  } catch (e) {
                    expect(e.errorNum).to.equal(errors.ERROR_FORBIDDEN.code, "Expected to get forbidden error code, but got another one");
                  }
                  expect(true).to.equal(false, `${name} was able to update a view with insufficent rights`);
                }
              });
            });
          });
        });
      }
    }
  });
});