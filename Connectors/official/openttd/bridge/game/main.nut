class EdenAgentBridge extends GSController {
    function Save() { return { bridge_version = 6 }; }
    function Load(version, data) {}

    function Start() {
        GSLog.Info("EdenAgentBridge started");
        GSAdmin.Send({ type = "bridge_ready", bridge_version = 6 });
        while (true) {
            while (GSEventController.IsEventWaiting()) {
                local event = GSEventController.GetNextEvent();
                if (event.GetEventType() == GSEvent.ET_ADMIN_PORT) {
                    try {
                        this.HandleCommand(GSEventAdminPort.Convert(event).GetObject());
                    } catch (error) {
                        GSLog.Error("EdenAgentBridge event failed: " + error.tostring());
                    }
                }
            }
            this.Sleep(1);
        }
    }

    function HandleCommand(command) {
        local request_id = command.rawin("request_id") ? command.request_id : "";
        local response = { type = "command_result", request_id = request_id, ok = false };
        try {
            if (!command.rawin("action")) throw "missing action";
            if (command.action == "ping") {
                response.ok = true;
                response.bridge_version <- 6;
            } else if (command.action == "get_state") {
                response.ok = true;
                response.date <- GSDate.GetCurrentDate();
                response.companies <- this.GetCompanies();
            } else if (command.action == "inspect_tile") {
                local tile = this.Tile(command);
                response.ok = true;
                response.tile <- tile;
                response.x <- GSMap.GetTileX(tile);
                response.y <- GSMap.GetTileY(tile);
                response.min_height <- GSTile.GetMinHeight(tile);
                response.max_height <- GSTile.GetMaxHeight(tile);
                response.buildable <- GSTile.IsBuildable(tile);
                response.owner <- GSTile.GetOwner(tile);
            } else if (command.action == "find_towns") {
                response.ok = true;
                response.towns <- this.FindTowns(command);
            } else if (command.action == "find_industries") {
                response.ok = true;
                response.industries <- this.FindIndustries(command);
            } else if (command.action == "get_company_assets") {
                response.ok = true;
                response.assets <- this.GetCompanyAssets(command.company_id);
            } else if (command.action == "list_road_engines") {
                response.ok = true;
                response.engines <- this.ListRoadEngines(command.company_id);
            } else if (command.action == "get_cargo_rates") {
                response.ok = true;
                response.cargo_rates <- this.GetCargoRates();
            } else if (command.action == "estimate_cargo_income") {
                response.ok = true;
                response.estimate <- this.EstimateCargoIncome(command);
            } else if (command.action == "find_road_route_site") {
                response.site <- this.FindRoadRouteSite(command);
                response.ok = response.site != null;
                if (!response.ok) response.error <- "no suitable straight route site found";
            } else if (command.action == "build_road") {
                local mode = GSCompanyMode(command.company_id);
                if (!GSCompanyMode.IsValid()) throw "invalid company_id";
                this.SelectRoadType();
                local costs = GSAccounting();
                response.ok = GSRoad.BuildRoad(GSMap.GetTileIndex(command.start_x, command.start_y), GSMap.GetTileIndex(command.end_x, command.end_y));
                if (!response.ok) response.error <- GSError.GetLastErrorString();
                response.cost <- costs.GetCosts();
            } else if (command.action == "build_road_path") {
                response = this.BuildRoadPath(command, response);
            } else if (command.action == "build_road_station") {
                local mode = GSCompanyMode(command.company_id);
                if (!GSCompanyMode.IsValid()) throw "invalid company_id";
                this.SelectRoadType();
                local vehicle_type = command.rawin("station_kind") && command.station_kind == "truck" ? GSRoad.ROADVEHTYPE_TRUCK : GSRoad.ROADVEHTYPE_BUS;
                local costs = GSAccounting();
                response.ok = GSRoad.BuildRoadStation(this.Tile(command), GSMap.GetTileIndex(command.front_x, command.front_y), vehicle_type, GSStation.STATION_NEW);
                if (!response.ok) response.error <- GSError.GetLastErrorString();
                response.cost <- costs.GetCosts();
            } else if (command.action == "build_road_depot") {
                local mode = GSCompanyMode(command.company_id);
                if (!GSCompanyMode.IsValid()) throw "invalid company_id";
                this.SelectRoadType();
                local costs = GSAccounting();
                response.ok = GSRoad.BuildRoadDepot(this.Tile(command), GSMap.GetTileIndex(command.front_x, command.front_y));
                if (!response.ok) response.error <- GSError.GetLastErrorString();
                response.cost <- costs.GetCosts();
            } else if (command.action == "fund") {
                if (!command.rawin("company_id") || !command.rawin("amount")) throw "missing company_id/amount";
                // A GameScript controller runs as deity by default, so ChangeBankBalance
                // can adjust any company's cash without an explicit deity company mode.
                response.ok = GSCompany.ChangeBankBalance(command.company_id, command.amount, GSCompany.EXPENSES_OTHER, GSMap.TILE_INVALID);
                response.balance <- GSCompany.GetBankBalance(command.company_id);
                if (!response.ok) response.error <- GSError.GetLastErrorString();
            } else if (command.action == "get_economy") {
                response.ok = true;
                response.economy <- this.ReadEconomySettings();
            } else if (command.action == "buy_road_vehicle") {
                response = this.BuyRoadVehicle(command, response);
            } else if (command.action == "modify_orders") {
                response = this.ModifyOrders(command, response);
            } else if (command.action == "build_hq_near") {
                local mode = GSCompanyMode(command.company_id);
                if (!GSCompanyMode.IsValid()) throw "invalid company_id";
                local radius = command.rawin("radius") ? command.radius : 12;
                local costs = GSAccounting();
                local built_tile = this.BuildHQNear(command.x, command.y, radius);
                response.ok = built_tile >= 0;
                response.tile <- built_tile;
                response.cost <- costs.GetCosts();
                if (!response.ok) response.error <- GSError.GetLastErrorString();
            } else {
                throw "unsupported gameplay action";
            }
        } catch (error) {
            response.ok = false;
            response.error <- error.tostring();
        }
        GSAdmin.Send(response);
    }

    function BuildRoadPath(command, response) {
        local mode = GSCompanyMode(command.company_id);
        if (!GSCompanyMode.IsValid()) throw "invalid company_id";
        this.SelectRoadType();
        local start_tile = GSMap.GetTileIndex(command.start_x, command.start_y);
        local end_tile = GSMap.GetTileIndex(command.end_x, command.end_y);
        if (start_tile == end_tile) throw "start and end are the same tile";
        local path = this.RoadPathBFS(start_tile, end_tile);
        if (path == null) throw "no road path found between start/end";
        local costs = GSAccounting();
        local built = [];
        // path is ordered start -> end; build a road segment between consecutive tiles.
        // GSRoad.BuildRoad auto-constructs bridges/tunnels when the terrain demands it.
        for (local i = 0; i + 1 < path.len(); i++) {
            local a = path[i];
            local b = path[i + 1];
            if (a == b) continue;
            if (!GSRoad.BuildRoad(a, b)) {
                throw "road build failed at " + GSMap.GetTileX(b) + "," + GSMap.GetTileY(b) + ": " + GSError.GetLastErrorString();
            }
            built.append({ x = GSMap.GetTileX(b), y = GSMap.GetTileY(b) });
        }
        response.ok = true;
        response.tiles_built <- built;
        response.length <- built.len();
        response.cost <- costs.GetCosts();
        return response;
    }

    // Dependency-free orthogonal BFS over buildable tiles, so the bridge does not
    // rely on OpenTTD's optional NoAI pathfinder library being installed.
    function RoadPathBFS(start_tile, end_tile) {
        local size_x = GSMap.GetMapSizeX();
        local size_y = GSMap.GetMapSizeY();
        local max_tiles = size_x * size_y;
        local visited = array(max_tiles, false);
        local came_from = array(max_tiles, -1);
        local queue = [start_tile];
        local queue_idx = 0;
        visited[start_tile] = true;
        local found = false;
        while (queue_idx < queue.len()) {
            local cur = queue[queue_idx++];
            if (cur == end_tile) { found = true; break; }
            local x = GSMap.GetTileX(cur);
            local y = GSMap.GetTileY(cur);
            local candidates = [];
            if (x + 1 < size_x) candidates.push(GSMap.GetTileIndex(x + 1, y));
            if (x - 1 >= 0)    candidates.push(GSMap.GetTileIndex(x - 1, y));
            if (y + 1 < size_y) candidates.push(GSMap.GetTileIndex(x, y + 1));
            if (y - 1 >= 0)    candidates.push(GSMap.GetTileIndex(x, y - 1));
            foreach (t in candidates) {
                if (visited[t]) continue;
                if (t != end_tile && !GSTile.IsBuildable(t)) continue;
                visited[t] = true;
                came_from[t] = cur;
                queue.push(t);
            }
        }
        if (!found) return null;
        local path = [];
        local cur = end_tile;
        while (cur != start_tile) {
            path.push(cur);
            cur = came_from[cur];
            if (cur < 0) return null;
        }
        path.push(start_tile);
        path.reverse();
        return path;
    }

    function ReadEconomySettings() {
        local result = {};
        try { result.max_loan <- GSCompany.GetMaxLoanAmount(); } catch (error) {}
        return result;
    }

    function Tile(command) {
        if (!command.rawin("x") || !command.rawin("y")) throw "missing x/y";
        return GSMap.GetTileIndex(command.x, command.y);
    }

    function CompanySummary(company_id) {
        local summary = {
            company_id = company_id,
            name = GSCompany.GetName(company_id),
            president = GSCompany.GetPresidentName(company_id),
            money = 0,
            company_value = 0,
        };
        try {
            summary.money = GSCompany.GetBankBalance(company_id);
            summary.company_value = GSCompany.GetQuarterlyCompanyValue(company_id, GSCompany.CURRENT_QUARTER);
        } catch (error) {
            // A single company failing to report must not break the whole get_state.
        }
        return summary;
    }

    function GetCompanies() {
        local result = [];
        for (local company_id = GSCompany.COMPANY_FIRST; company_id < GSCompany.COMPANY_LAST; company_id++) {
            if (GSCompany.ResolveCompanyID(company_id) == GSCompany.COMPANY_INVALID) continue;
            result.append(this.CompanySummary(company_id));
        }
        return result;
    }

    function CenterTile(command) {
        local x = command.rawin("x") ? command.x : GSMap.GetMapSizeX() / 2;
        local y = command.rawin("y") ? command.y : GSMap.GetMapSizeY() / 2;
        return GSMap.GetTileIndex(x, y);
    }

    function Limit(command) {
        local limit = command.rawin("limit") ? command.limit : 20;
        if (limit < 1) return 1;
        return limit > 100 ? 100 : limit;
    }

    function FindTowns(command) {
        local center = this.CenterTile(command);
        local result = [];
        local towns = GSTownList();
        for (local town_id = towns.Begin(); !towns.IsEnd(); town_id = towns.Next()) {
            local tile = GSTown.GetLocation(town_id);
            result.append({ town_id = town_id, name = GSTown.GetName(town_id), population = GSTown.GetPopulation(town_id), tile = tile, x = GSMap.GetTileX(tile), y = GSMap.GetTileY(tile), distance = GSTown.GetDistanceManhattanToTile(town_id, center) });
        }
        result.sort(function(a, b) { return a.distance < b.distance ? -1 : (a.distance > b.distance ? 1 : 0); });
        return result.slice(0, result.len() < this.Limit(command) ? result.len() : this.Limit(command));
    }

    function SafeCargoSlots(type_id, produced) {
        // GSIndustryType.GetProducedCargo/GetAcceptedCargo return the industry TYPE's
        // default cargoes; a concrete industry (especially NewGRF) may override these
        // on construction, so callers must treat them as type-level defaults only.
        try {
            local list = produced ? GSIndustryType.GetProducedCargo(type_id) : GSIndustryType.GetAcceptedCargo(type_id);
            local slots = [];
            if (list == null) return slots;
            for (local cargo = list.Begin(); !list.IsEnd(); cargo = list.Next()) {
                slots.append({ cargo_id = cargo, name = GSCargo.GetName(cargo) });
            }
            return slots;
        } catch (error) {
            return [];
        }
    }

    function FindIndustries(command) {
        local center = this.CenterTile(command);
        local result = [];
        local industries = GSIndustryList();
        for (local industry_id = industries.Begin(); !industries.IsEnd(); industry_id = industries.Next()) {
            local tile = GSIndustry.GetLocation(industry_id);
            local type_id = GSIndustry.GetIndustryType(industry_id);
            result.append({
                industry_id = industry_id,
                name = GSIndustry.GetName(industry_id),
                type_id = type_id,
                type_name = GSIndustryType.GetName(type_id),
                type_default_produces = this.SafeCargoSlots(type_id, true),
                type_default_accepts = this.SafeCargoSlots(type_id, false),
                production = this.IndustryProduction(industry_id, type_id),
                production_level = GSIndustry.GetProductionLevel(industry_id),
                tile = tile,
                x = GSMap.GetTileX(tile),
                y = GSMap.GetTileY(tile),
                distance = GSIndustry.GetDistanceManhattanToTile(industry_id, center),
            });
        }
        result.sort(function(a, b) { return a.distance < b.distance ? -1 : (a.distance > b.distance ? 1 : 0); });
        return result.slice(0, result.len() < this.Limit(command) ? result.len() : this.Limit(command));
    }

    function GetCompanyAssets(company_id) {
        local mode = GSCompanyMode(company_id);
        if (!GSCompanyMode.IsValid()) throw "invalid company_id";
        local stations_result = [];
        local stations = GSStationList(GSStation.STATION_ANY);
        for (local station_id = stations.Begin(); !stations.IsEnd(); station_id = stations.Next()) {
            local tile = GSBaseStation.GetLocation(station_id);
            local types = [];
            if (GSStation.HasStationType(station_id, GSStation.STATION_TRAIN)) types.append("train");
            if (GSStation.HasStationType(station_id, GSStation.STATION_TRUCK_STOP)) types.append("truck");
            if (GSStation.HasStationType(station_id, GSStation.STATION_BUS_STOP)) types.append("bus");
            if (GSStation.HasStationType(station_id, GSStation.STATION_AIRPORT)) types.append("airport");
            if (GSStation.HasStationType(station_id, GSStation.STATION_DOCK)) types.append("dock");
            local accepted = [];
            local accepted_cargos = GSCargoList_StationAccepting(station_id);
            for (local cargo_id = accepted_cargos.Begin(); !accepted_cargos.IsEnd(); cargo_id = accepted_cargos.Next()) {
                accepted.append({ cargo_id = cargo_id, name = GSCargo.GetName(cargo_id), waiting = GSStation.GetCargoWaiting(station_id, cargo_id) });
            }
            stations_result.append({ station_id = station_id, name = GSBaseStation.GetName(station_id), station_types = types, accepted_cargo = accepted, tile = tile, x = GSMap.GetTileX(tile), y = GSMap.GetTileY(tile) });
        }
        local vehicles_result = [];
        local vehicles = GSVehicleList();
        for (local vehicle_id = vehicles.Begin(); !vehicles.IsEnd(); vehicle_id = vehicles.Next()) {
            local tile = GSVehicle.GetLocation(vehicle_id);
            local loaded = [];
            local cargos = GSCargoList();
            for (local cargo_id = cargos.Begin(); !cargos.IsEnd(); cargo_id = cargos.Next()) {
                local load = GSVehicle.GetCargoLoad(vehicle_id, cargo_id);
                if (load > 0) {
                    loaded.append({ cargo_id = cargo_id, cargo_name = GSCargo.GetName(cargo_id), cargo_load = load, cargo_capacity = GSVehicle.GetCapacity(vehicle_id, cargo_id) });
                }
            }
            vehicles_result.append({ vehicle_id = vehicle_id, name = GSVehicle.GetName(vehicle_id), vehicle_type = GSVehicle.GetVehicleType(vehicle_id), state = GSVehicle.GetState(vehicle_id), cargo_loaded = loaded, profit_this_year = GSVehicle.GetProfitThisYear(vehicle_id), profit_last_year = GSVehicle.GetProfitLastYear(vehicle_id), orders = this.GetVehicleOrders(vehicle_id), tile = tile, x = GSMap.GetTileX(tile), y = GSMap.GetTileY(tile) });
        }
        return { company_id = company_id, hq_tile = GSCompany.GetCompanyHQ(company_id), stations = stations_result, vehicles = vehicles_result };
    }

    function GetVehicleOrders(vehicle_id) {
        local result = [];
        local count = GSOrder.GetOrderCount(vehicle_id);
        for (local position = 0; position < count; position++) {
            local tile = GSOrder.GetOrderDestination(vehicle_id, position);
            local flags = GSOrder.GetOrderFlags(vehicle_id, position);
            result.append({ position = position, tile = tile, x = GSMap.GetTileX(tile), y = GSMap.GetTileY(tile), flags = flags, unload = (flags & GSOrder.OF_UNLOAD) != 0, transfer = (flags & GSOrder.OF_TRANSFER) != 0, no_unload = (flags & GSOrder.OF_NO_UNLOAD) != 0, full_load = (flags & GSOrder.OF_FULL_LOAD) != 0, full_load_any = (flags & GSOrder.OF_FULL_LOAD_ANY) != 0, no_load = (flags & GSOrder.OF_NO_LOAD) != 0, non_stop = (flags & GSOrder.OF_NON_STOP_DESTINATION) != 0 });
        }
        return result;
    }

    function ModifyOrders(command, response) {
        local mode = GSCompanyMode(command.company_id);
        if (!GSCompanyMode.IsValid()) throw "invalid company_id";
        local vehicle_id = command.vehicle_id;
        if (!GSVehicle.IsValidVehicle(vehicle_id)) throw "invalid vehicle_id";
        if (command.rawin("orders")) {
            foreach (op in command.orders) {
                local action = op.rawin("action") ? op.action : "";
                if (action == "set_flags") {
                    local flags = this.OrderFlags(op);
                    if (!GSOrder.SetOrderFlags(vehicle_id, op.position, flags)) throw GSError.GetLastErrorString();
                } else if (action == "remove") {
                    if (!GSOrder.RemoveOrder(vehicle_id, op.position)) throw GSError.GetLastErrorString();
                } else if (action == "insert") {
                    local dest = GSMap.GetTileIndex(op.x, op.y);
                    local flags = this.OrderFlags(op);
                    if (!GSOrder.InsertOrder(vehicle_id, op.position, dest, flags)) throw GSError.GetLastErrorString();
                } else if (action == "move") {
                    if (!GSOrder.MoveOrder(vehicle_id, op.position, op.target)) throw GSError.GetLastErrorString();
                } else {
                    throw "unsupported order action: " + action;
                }
            }
        }
        response.ok = true;
        response.orders <- this.GetVehicleOrders(vehicle_id);
        return response;
    }

    function OrderFlags(op) {
        local flags = GSOrder.OF_NONE;
        if (op.rawin("unload") && op.unload) flags = flags | GSOrder.OF_UNLOAD;
        if (op.rawin("transfer") && op.transfer) flags = flags | GSOrder.OF_TRANSFER;
        if (op.rawin("no_unload") && op.no_unload) flags = flags | GSOrder.OF_NO_UNLOAD;
        if (op.rawin("full_load") && op.full_load) flags = flags | GSOrder.OF_FULL_LOAD;
        if (op.rawin("full_load_any") && op.full_load_any) flags = flags | GSOrder.OF_FULL_LOAD_ANY;
        if (op.rawin("no_load") && op.no_load) flags = flags | GSOrder.OF_NO_LOAD;
        if (op.rawin("non_stop") && op.non_stop) flags = flags | GSOrder.OF_NON_STOP_DESTINATION;
        return flags;
    }

    function ListRoadEngines(company_id) {
        local mode = GSCompanyMode(company_id);
        if (!GSCompanyMode.IsValid()) throw "invalid company_id";
        local result = [];
        local engines = GSEngineList(GSVehicle.VT_ROAD);
        for (local engine_id = engines.Begin(); !engines.IsEnd(); engine_id = engines.Next()) {
            if (!GSEngine.IsBuildable(engine_id)) continue;
            local cargo = GSEngine.GetCargoType(engine_id);
            result.append({ engine_id = engine_id, name = GSEngine.GetName(engine_id), cargo_id = cargo, cargo_name = GSCargo.GetName(cargo), passenger = GSCargo.HasCargoClass(cargo, GSCargo.CC_PASSENGERS), capacity = GSEngine.GetCapacity(engine_id), max_speed = GSEngine.GetMaxSpeed(engine_id), running_cost = GSEngine.GetRunningCost(engine_id), price = GSEngine.GetPrice(engine_id), design_year = GSEngine.GetDesignDate(engine_id) / 365, power = GSEngine.GetPower(engine_id) });
        }
        return result;
    }

    function IndustryProduction(industry_id, type_id) {
        local items = [];
        try {
            local produced = GSIndustryType.GetProducedCargo(type_id);
            if (produced != null) {
                for (local cargo = produced.Begin(); !produced.IsEnd(); cargo = produced.Next()) {
                    items.append({
                        cargo_id = cargo,
                        name = GSCargo.GetName(cargo),
                        last_month_production = GSIndustry.GetLastMonthProduction(industry_id, cargo),
                        last_month_transported = GSIndustry.GetLastMonthTransported(industry_id, cargo),
                    });
                }
            }
        } catch (error) {
            // Leave empty on any industry-level API failure.
        }
        return items;
    }

    function GetCargoRates() {
        local result = [];
        local cargos = GSCargoList();
        for (local cargo = cargos.Begin(); !cargos.IsEnd(); cargo = cargos.Next()) {
            if (!GSCargo.IsValidCargo(cargo)) continue;
            local rates = [];
            foreach (dist in [10, 50, 100]) {
                rates.append({ distance = dist, income_per_piece = GSCargo.GetCargoIncome(cargo, dist, 10) });
            }
            result.append({
                cargo_id = cargo,
                name = GSCargo.GetName(cargo),
                label = GSCargo.GetCargoLabel(cargo),
                income_per_piece_days10 = rates,
            });
        }
        return result;
    }

    function EstimateCargoIncome(command) {
        local cargo = command.rawin("cargo_id") ? command.cargo_id : null;
        local distance = command.rawin("distance") ? command.distance : 10;
        local days = command.rawin("days") ? command.days : 10;
        if (cargo == null || !GSCargo.IsValidCargo(cargo)) throw "invalid or missing cargo_id";
        return { cargo_id = cargo, distance = distance, days_in_transit = days, income_per_piece = GSCargo.GetCargoIncome(cargo, distance, days) };
    }

    function FlatBuildable(tile) {
        return GSTile.IsBuildable(tile) && GSTile.GetMinHeight(tile) == GSTile.GetMaxHeight(tile);
    }

    function FindRoadRouteSite(command) {
        local length = command.rawin("length") ? command.length : 12;
        if (length < 6) length = 6;
        if (length > 40) length = 40;
        for (local y = 3; y < GSMap.GetMapSizeY() - 3; y++) {
            for (local x = 3; x + length < GSMap.GetMapSizeX() - 3; x++) {
                local valid = true;
                for (local offset = 0; offset <= length; offset++) {
                    if (!GSTile.IsBuildable(GSMap.GetTileIndex(x + offset, y))) { valid = false; break; }
                }
                if (!valid) continue;
                local station_a = GSMap.GetTileIndex(x, y - 1);
                local station_b = GSMap.GetTileIndex(x + length, y - 1);
                local depot = GSMap.GetTileIndex(x + 1, y + 1);
                if (!this.FlatBuildable(station_a) || !this.FlatBuildable(station_b) || !this.FlatBuildable(depot)) continue;
                return { road_start = { x = x, y = y }, road_end = { x = x + length, y = y }, station_a = { x = x, y = y - 1, front_x = x, front_y = y }, station_b = { x = x + length, y = y - 1, front_x = x + length, front_y = y }, depot = { x = x + 1, y = y + 1, front_x = x + 1, front_y = y } };
            }
        }
        return null;
    }

    function BuyRoadVehicle(command, response) {
        local mode = GSCompanyMode(command.company_id);
        if (!GSCompanyMode.IsValid()) throw "invalid company_id";
        local depot = this.Tile(command);
        local costs = GSAccounting();
        local vehicle_id = GSVehicle.BuildVehicle(depot, command.engine_id);
        if (!GSVehicle.IsValidVehicle(vehicle_id)) {
            response.ok = false;
            response.error <- GSError.GetLastErrorString();
            return response;
        }
        if (command.rawin("orders")) {
            foreach (order in command.orders) {
                local destination = GSMap.GetTileIndex(order.x, order.y);
                local flags = this.OrderFlags(order);
                if (!GSOrder.AppendOrder(vehicle_id, destination, flags)) throw GSError.GetLastErrorString();
            }
        }
        local should_start = !command.rawin("start") || command.start;
        if (should_start && !GSVehicle.StartStopVehicle(vehicle_id)) throw GSError.GetLastErrorString();
        response.ok = true;
        response.vehicle_id <- vehicle_id;
        response.cost <- costs.GetCosts();
        return response;
    }

    function SelectRoadType() {
        local road_types = GSRoadTypeList(GSRoad.ROADTRAMTYPES_ROAD);
        local road_type = road_types.Begin();
        if (road_types.IsEnd()) throw "no road type available";
        GSRoad.SetCurrentRoadType(road_type);
    }

    function BuildHQNear(center_x, center_y, radius) {
        local min_x = center_x - radius < 1 ? 1 : center_x - radius;
        local min_y = center_y - radius < 1 ? 1 : center_y - radius;
        local max_x = center_x + radius >= GSMap.GetMapSizeX() - 1 ? GSMap.GetMapSizeX() - 2 : center_x + radius;
        local max_y = center_y + radius >= GSMap.GetMapSizeY() - 1 ? GSMap.GetMapSizeY() - 2 : center_y + radius;
        for (local y = min_y; y <= max_y; y++) {
            for (local x = min_x; x <= max_x; x++) {
                local tile = GSMap.GetTileIndex(x, y);
                if (GSTile.IsBuildableRectangle(tile, 2, 2) && GSCompany.BuildCompanyHQ(tile)) return tile;
            }
        }
        return -1;
    }
}
