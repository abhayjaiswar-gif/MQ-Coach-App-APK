const configs = {
  ISP: {
    masterTable: "year_lp_master",
    masterNewTable: "year_lp_master_new",
    importEndpoint: "/api/curriculum/import",
    idColumn: "id_indicate_curriculum",
    sportLabel: "Select Sport",
  },
  SDP: {
    masterTable: "sdp_lp_master",
    masterNewTable: "sdp_lp_master_new",
    importEndpoint: "/api/curriculum/sdp/import",
    idColumn: "id_indicate_curriculum",
    sportLabel: "Select Under Group",
  },
  MSFC: {
    masterTable: "msfc_lp_master",
    masterNewTable: "msfc_lp_master_new",
    importEndpoint: "/api/curriculum/msfc/import",
    idColumn: "id_indicate_curriculum",
    sportLabel: "Select Sport",
  },
};

function getConfig(programType) {
  const cfg = configs[programType];
  if (!cfg) throw new Error(`Unknown program type: ${programType}`);
  return cfg;
}

module.exports = { configs, getConfig };
