'use strict';

var fs = require("fs");

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
    let mbr = tryParseMbr(imgPath);
    if (mbr !== null) {
        // create partInfo objects for mbr and all partitions
        
        // display them
    } else {
        // display mbr error
    }
    
};

// checks if image has Msdos/MBR or GPT partition scheme or invalid
function tryParseMbr(imgPath) {
    // open image
    var fd = fs.openSync(imgPath, 'r');
    var mbrBuf = Buffer.alloc(512);
    var numRead = fs.readSync(fd, mbrBuf, 0, 512, 0);
    fs.closeSync(fd);
    if (numRead == 512) {
        console.log("Sucessfully read:", numRead, "bytes.");
        // check for signature 0x55AA
        if (mbrBuf.readUInt16BE(510) == 0x55AA) {
            // parse mbr
            let mbr = parseMbr(mbrBuf);
            return mbr;
        } else {
            // invalid signature of mbr
            console.log("Error: Invalid MBR signature!");
            return null;
        }
    } 
    else {
        console.log("Error while reading ", imgPath);
        return null;
    }
    
    
}

// analyze master boot record (sector 0 of image)
function parseMbr(buf) {
    let mbr = new DataSection(0, 0, 512, "MBR", raw, buf, "Master Boot Record");
    mbr.children.push(new DataSection(0, 0, 446, "Boot code", raw, buf.slice(0, 0+446), "Bootstrap code area"));
    mbr.children.push(new DataSection(0, 446, 16, "Partition Entry #1", raw, buf.slice(446, 446+16), ""));
    mbr.children.push(new DataSection(0, 462, 16, "Partition Entry #2", raw, buf.slice(462, 462+16), ""));
    mbr.children.push(new DataSection(0, 478, 16, "Partition Entry #3", raw, buf.slice(478, 478+16), ""));
    mbr.children.push(new DataSection(0, 494, 16, "Partition Entry #4", raw, buf.slice(494, 494+16), ""));
    mbr.children.push(new DataSection(0, 510, 2, "Signature", raw, [0x55, 0xAA],  "The signature"));

    return mbr;
};

function parsePartitionEntry(ds) {
    // 0,1 status
    // 1,3 CHS address of start sector
    // 4,1 Parition type
    // 5,3 CHS address of last sector
    // 8,4 LBA of first sector
    // 12,4 Number of sectors in partition
}

// analyze gpt scheme
function analyzeGpt(imgPath) {
    
}

function createPartitionElement(partInfo) {
    var item = document.createElement("li");
    item.classList.add("sectordesc");
    item.innerHTML = "<div>" + partInfo.name + "</div>";
    item.innerHTML += "<div>" + "Sector Offset: " + partInfo.startSector + "</div>";
    item.innerHTML += "<div>" + "Num of Sectors: " + partInfo.numSectors + "</div>";
    return item;
}

class PartInfo {
    constructor(name, startSector, numSectors) {
        this.name = name;
        this.startSector = startSector;
        this.numSectors = numSectors;
    }
}

class PartitionScheme {
    constructor() {
        this.pInfoList = [];
    }
}


class DataSection {
    constructor(sector, offset, size, name, valueType, data, desc) {
        this.sector = sector;
        this.offset = offset;
        this.size = size;
        this.name = name;
        this.valueType = valueType;
        this.data = data;
        this.desc = desc;
        this.children = []; // children list of DataSections; fine grained description
    }

    get value() {
        return this.valueType(this.data);
    }
}

function raw(data) {
    let rawStr = "[";
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
    return rawStr;
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