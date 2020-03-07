'use strict';

var fs = require("fs");
var util = require("util");

function onLoadImage() {
    var imgPath = document.getElementById("imgPath").value;
    console.log("Loading image:", imgPath);
    // var p1 = new PartInfo("MBR", 0, 1);
    // var p2 = new PartInfo("Lul", 1, 1337);
    // var p3 = new PartInfo("Rofl", 1338, 114);
    // var partList = document.getElementById("partList");
    // partList.appendChild(createPartitionElement(p1));
    // partList.appendChild(createPartitionElement(p2));
    // partList.appendChild(createPartitionElement(p3));
    
    // clear displayed partitions
    var mbr = null;
    try {
        mbr = tryParseMbr(imgPath);    
    } catch (error) {
        console.log(error);
    }
    // MBR sucessfully parsed
    var partList = document.getElementById("partList");
    partList.appendChild(createPartitionElement(mbr));

    createDetailedView(mbr);
};

// checks if image has Msdos/MBR or GPT partition scheme or invalid
function tryParseMbr(imgPath) {
    var mbr = parseMbr(imgPath);
    var sig = mbr.children[mbr.children.length-1].value;
    if (sig != 0x55AA) {
        throw "Wrong signature: " + sig;
    }
    return mbr;
}

// analyze master boot record (sector 0 of image)
function parseMbr(imgPath) {
    let mbr = new DataSection(imgPath, 0, 512, "MBR", hexArray, "Master Boot Record");
    mbr.children.push(new DataSection(imgPath, 0, 446, "Boot code", hexArray, "Bootstrap code area"));
    mbr.children.push(addPartitionEntry(new DataSection(imgPath, 446, 16, "Partition Entry #1", hexArray, "")));
    mbr.children.push(addPartitionEntry(new DataSection(imgPath, 462, 16, "Partition Entry #2", hexArray, "")));
    mbr.children.push(addPartitionEntry(new DataSection(imgPath, 478, 16, "Partition Entry #3", hexArray, "")));
    mbr.children.push(addPartitionEntry(new DataSection(imgPath, 494, 16, "Partition Entry #4", hexArray, "")));
    mbr.children.push(new DataSection(imgPath, 510, 2, "Signature", uintBE,  "The signature"));

    return mbr;
};

function addPartitionEntry(ds) {
    var offset = ds.offset;
    var imgPath = ds.imgPath;
    // 0,1 status
    ds.children.push(new DataSection(imgPath, offset+0, 1, "Status", uintLE, "Status of the Partition"));
    // 1,3 CHS address of start sector
    ds.children.push(new DataSection(imgPath, offset+1, 3, "CHS Start", hexArray, "CHS Start Sector of partition"));
    // 4,1 Parition type
    ds.children.push(new DataSection(imgPath, offset+4, 1, "Partition type", uintLE, ""));
    // 5,3 CHS address of last sector
    ds.children.push(new DataSection(imgPath, offset+5, 3, "CHS End", hexArray, "CHS Last Sector of partition"));
    // 8,4 LBA of first sector
    ds.children.push(new DataSection(imgPath, offset+8, 4, "LBA Start", uintLE, "LBA of first sector"));
    // 12,4 Number of sectors in partition
    ds.children.push(new DataSection(imgPath, offset+12, 4, "Number of sectors", uintLE, "Size of partition in sectors"));
    return ds;
}

// analyze gpt scheme
function analyzeGpt(imgPath) {
    
}

function createPartitionElement(ds) {
    var item = document.createElement("li");
    item.classList.add("sectordesc");
    item.innerHTML = "<div>" + ds.name + "</div>";
    item.innerHTML += "<div>" + "Sector Offset: " + ds.offset / 512 + "</div>";
    item.innerHTML += "<div>" + "Num of Sectors: " + ds.size / 512 + "</div>";
    return item;
}

function createDetailedView(ds) {
    var old_tbody = document.getElementById("detailsBody");
    var new_tbody = document.createElement('tbody');
    old_tbody.parentNode.replaceChild(new_tbody, old_tbody);
    var childs = dsToTableRows(new_tbody, ds);
}

function dsToTableRows(tBody, ds) {
    var row = tBody.insertRow(-1);
    dsFillRow(row, ds);
    var node = {};
    node.row = row;
    
    node.children = [];
    ds.children.forEach(element => {
        node.children.push(dsToTableRows(tBody, element));
    });
    
    if (node.children.length > 0) {
        node.collapsed = false;
        row.classList.add("expandable");
        row.onclick = ( function (){
            
            if (node.collapsed) {
                var nodes = getSubnodes(node, 1);
                nodes.forEach(element => {
                    element.row.classList.remove("hidden");
                });
                node.collapsed = false;
            }
            else {
                var nodes = getSubnodes(node);
                nodes.forEach(element => {
                    if (element.hasOwnProperty("collapsed")) {
                        element.collapsed = true;
                    }
                    element.row.classList.add("hidden");
                });
                node.collapsed = true;
            }
        });    
    }    

    return node;
}

function getSubnodes(node, levels = -1) {
    var list = []
    
    if (levels != -1) {
        levels--;
        if (levels < 0) return [];
    }

    node.children.forEach(element => {
        list.push(element);
        var subnodes = (getSubnodes(element, levels));
        subnodes.forEach(element => {
            list.push(element);
        });
    });
    return list;
}

function dsFillRow(row, ds) {
    row.insertCell(-1).innerHTML = ds.offset;
    row.insertCell(-1).innerHTML = ds.size;
    row.insertCell(-1).innerHTML = ds.name;

    var valRow = row.insertCell(-1);
    valRow.classList.add("value");
    if (ds.valueType == hexArray && ds.size > 32)
        valRow.innerHTML = ds.value.slice(0, 32).concat(["..."]);
    else
        valRow.innerHTML = ds.value.toString(16).toUpperCase();

    row.insertCell(-1).innerHTML = ds.desc;
}

/* class PartInfo {
    constructor(name, startSector, numSectors) {
        this.name = name;
        this.startSector = startSector;
        this.numSectors = numSectors;
    }
} */

/* class PartitionScheme {
    constructor() {
        this.pInfoList = [];
    }
}
 */

class DataSection {
    constructor(imgPath, offset, size, name, valueType, desc) {
        this.imgPath = imgPath;
        this.offset = offset;
        this.size = size;
        this.name = name;
        this.valueType = valueType;
        this.desc = desc;
        this.children = []; // children list of DataSections; fine grained description
    }

    readData(offset = this.offset, size = this.size) {
        // check data
        if (offset > this.offset + this.size ||
            size > this.size ||
            offset + size > this.offset + this.size) {
                throw "Out of bounds read!";
            } 
        
        // open image
        var fd = fs.openSync(this.imgPath, 'r');
        var rBuf = Buffer.alloc(size);
        var numRead = fs.readSync(fd, rBuf, 0, size, offset);
        fs.closeSync(fd);
        if (numRead == size) {
            console.log("Sucessfully read:", numRead, "bytes.");
            return rBuf;
        } 
        else {
            console.log("Error while reading ", imgPath);
            throw "Read error";
        }
    }

    get value() {
        return this.valueType(this.readData());
    }

}

function hexArray(data) {
/*     let rawStr = "[";
    let values = "";
    let elem;
    for (elem of data) {
        values += elem;
        values += ", ";
    }
    if (values.length > 0) {
        values = values.slice(0, -2);
    }
    rawStr += values;
    rawStr += "]";
    return rawStr; */
    var ar = [];
    for (const elem of data) {
        ar.push(("00" + elem.toString(16).toUpperCase()).slice(-2));
    }
    return ar;
}

function uintLE(data) {
    // reverse array
    let revData = data.slice();
    revData.reverse()
    // call uintBE(data)
    return uintBE(revData);
}

function uintBE(data) {
    let val = 0;
    let elem = 0;
    for (elem of data) {
        val = val * 256;
        val += elem;
    }
    return val;
}