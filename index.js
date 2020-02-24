var fs = require("fs");

function onLoadImage() {
    var imgPath = document.getElementById("imgPath").value;
    console.log("Loading image:", imgPath);
    var p1 = new PartInfo("MBR", 0, 1);
    var p2 = new PartInfo("Lul", 1, 1337);
    var p3 = new PartInfo("Rofl", 1338, 114);
    var partList = document.getElementById("partList");
    partList.appendChild(createPartitionElement(p1));
    partList.appendChild(createPartitionElement(p2));
    partList.appendChild(createPartitionElement(p3));
};

// checks if image has Msdos/MBR or GPT partition scheme or invalid
function checkPartitionSystem(imgPath) {

}

// analyze master boot record (sector 0 of image)
function analyzeMbr(imgPath) {

};

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

class DataSection {
    constructor(sector, offset, size, name, value, desc) {
        this.sector = sector;
        this.offset = offset;
        this.size = size;
        this.name = name;
        this.value = value;
        this.desc = desc;
    }
}